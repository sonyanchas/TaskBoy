const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
// Load environment variables from the server directory .env
require('dotenv').config({ path: path.join(__dirname, '.env') });
const multer = require('multer');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Paystack config
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const paystack = axios.create({
  baseURL: PAYSTACK_BASE_URL,
  headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
});

const app = express();
app.use(cors());

// ========================================================
// Paystack webhook — must see the RAW body (for signature
// verification) before express.json() parses anything, so
// this route + raw parser must be registered before app.use(express.json())
// ========================================================
app.post(
  '/api/paystack-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['x-paystack-signature'];
    const expectedSignature = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(req.body)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.log('⚠️  Paystack webhook signature verification failed.');
      return res.sendStatus(400);
    }

    const event = JSON.parse(req.body);

    if (event.event === 'charge.success') {
      const { reference, status, amount, metadata } = event.data;

      try {
        // Idempotent update: only flips a booking to 'paid' if it isn't already,
        // since Paystack may retry webhook delivery
        const { error } = await supabase
          .from('bookings')
          .update({ status: 'paid', updated_at: new Date().toISOString() })
          .eq('payment_reference', reference)
          .eq('status', 'pending');

        if (error) console.error('Error updating booking from webhook:', error);
      } catch (err) {
        console.error('Webhook processing error:', err);
      }
    } else {
      console.log(`Unhandled Paystack event type: ${event.event}`);
    }

    res.sendStatus(200);
  }
);

// Regular JSON/body parsers for everything else, registered after the webhook route
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up multer for handling file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Serve static files from React build folder
app.use(express.static(path.join(__dirname, '../client/build')));

// Helper: look up a Supabase Auth user's UUID from their email
async function getUserIdByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  return user ? user.id : null;
}

// ========================================================
// Authentication Routes using Supabase Auth
// ========================================================

app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    console.log(`Received registration request for email: ${email}`);

    // Accept any valid email address (no domain restriction)
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
        return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    try {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { name } }
        });

        if (error) throw error;

        res.json({ success: true, message: 'Registration successful. Check your email for verification.' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: error.message || 'Error registering user' });
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    console.log(`Received login request for email: ${email}`);

    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const name = data.user.user_metadata?.name || 'User';

        res.json({ success: true, message: 'Login successful', name, user: data.user });
    } catch (error) {
        console.error('Login error:', error);
        res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
});

app.post('/verify', async (req, res) => {
    const { email, verificationCode } = req.body;
    console.log(`Verifying email: ${email} with code: ${verificationCode}`);

    try {
        const { data, error } = await supabase.auth.verifyOtp({
            email,
            token: verificationCode,
            type: 'signup'
        });

        if (error) {
            console.error('Verification failed:', error);
            return res.status(400).json({ success: false, message: 'Invalid verification code.' });
        }

        res.json({ success: true, message: 'Email verified successfully' });
    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({ success: false, message: 'Error verifying email' });
    }
});

// ========================================================
// Tasker Onboarding (Paystack Subaccounts)
// ========================================================

// List banks so the frontend can render a dropdown instead of asking for a raw bank code
app.get('/api/banks', async (req, res) => {
  const { country = 'kenya' } = req.query;
  try {
    const response = await paystack.get('/bank', { params: { country } });
    const banks = response.data.data.map((bank) => ({
      code: bank.code,
      name: bank.name,
    }));
    res.json({ success: true, banks });
  } catch (error) {
    console.error('Error fetching banks:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Error fetching bank list' });
  }
});

// Check whether the current user has already onboarded as a Tasker
app.get('/api/tasker/status', async (req, res) => {
  const userEmail = req.headers['user-id'];
  if (!userEmail) {
    return res.status(401).json({ success: false, message: 'User authentication required' });
  }

  try {
    const userId = await getUserIdByEmail(userEmail);
    if (!userId) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { data, error } = await supabase
      .from('taskers')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;

    res.json({ success: true, onboarded: !!data });
  } catch (error) {
    console.error('Error checking tasker status:', error);
    res.status(500).json({ success: false, message: 'Error checking tasker status' });
  }
});

// Create a Paystack subaccount for a Tasker and store it
app.post('/api/tasker/onboard', async (req, res) => {
  const userEmail = req.headers['user-id'];
  const { businessName, bankCode, accountNumber } = req.body;

  if (!userEmail) {
    return res.status(401).json({ success: false, message: 'User authentication required' });
  }
  if (!businessName || !bankCode || !accountNumber) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    const userId = await getUserIdByEmail(userEmail);
    if (!userId) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Create the subaccount on Paystack. percentage_charge is your platform's
    // cut — e.g. 15 means 15% goes to your main account, 85% to the Tasker.
    const response = await paystack.post('/subaccount', {
      business_name: businessName,
      bank_code: bankCode,
      account_number: accountNumber,
      percentage_charge: 15,
    });

    const subaccountCode = response.data.data.subaccount_code;
    const accountNumberLast4 = accountNumber.slice(-4);

    const { error } = await supabase
      .from('taskers')
      .upsert({
        user_id: userId,
        business_name: businessName,
        paystack_subaccount_code: subaccountCode,
        bank_code: bankCode,
        account_number_last4: accountNumberLast4,
      });

    if (error) throw error;

    res.json({ success: true, message: 'Payout setup complete', subaccountCode });
  } catch (error) {
    console.error('Error onboarding tasker:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || 'Error setting up payouts',
    });
  }
});

// ========================================================
// Task Listings API (fixed-price services posted by Taskers)
// ========================================================

app.post('/tasks', upload.single('image'), async (req, res) => {
  const { title, description, category, location, price } = req.body;
  const { file } = req;
  const userEmail = req.headers['user-id'];

  if (!userEmail) {
    return res.status(401).json({ success: false, message: 'User authentication required' });
  }

  try {
    const userId = await getUserIdByEmail(userEmail);
    if (!userId) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Guard: a Tasker must have a Paystack subaccount on file before they can
    // list a service, otherwise there's no way to ever pay them.
    const { data: taskerRow, error: taskerError } = await supabase
      .from('taskers')
      .select('paystack_subaccount_code')
      .eq('user_id', userId)
      .maybeSingle();

    if (taskerError) throw taskerError;
    if (!taskerRow) {
      return res.status(412).json({
        success: false,
        message: 'Please set up payouts before listing a service',
      });
    }

    let imageURL = null;
    if (file) {
      const fileName = `${Date.now()}_${file.originalname}`;
      const { error: fileError } = await supabase.storage
        .from('task-images')
        .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: true });

      if (fileError) throw fileError;

      const { data: publicUrlData } = supabase.storage
        .from('task-images')
        .getPublicUrl(fileName);
      imageURL = publicUrlData.publicUrl;
    }

    const { data, error } = await supabase
      .from('tasks')
      .insert([{ tasker_id: userId, title, description, category, location, price, imageURL }])
      .select();

    if (error) throw error;

    res.json({ success: true, message: 'Service listed successfully', task: data[0] });
  } catch (error) {
    console.error('Error posting task:', error);
    res.status(500).json({ success: false, message: error.message || 'Error posting service' });
  }
});

// Search/browse tasks — attaches each Tasker's name and subaccount code so
// the frontend can go straight into payment without another round trip
app.get('/tasks/search', async (req, res) => {
  const { query = '' } = req.query;

  try {
    let dbQuery = supabase.from('tasks').select('*');

    if (query.trim()) {
      dbQuery = dbQuery.or(
        `title.ilike.%${query}%,category.ilike.%${query}%,location.ilike.%${query}%,description.ilike.%${query}%`
      );
    }

    const { data: tasks, error } = await dbQuery;
    if (error) throw error;

    // tasks.tasker_id and taskers.user_id both reference auth.users, but
    // there's no direct FK between tasks and taskers, so Supabase can't
    // auto-embed this join — fetch taskers separately and merge in JS.
    const taskerIds = [...new Set(tasks.map((t) => t.tasker_id))];
    const { data: taskerRows, error: taskerError } = await supabase
      .from('taskers')
      .select('user_id, business_name, paystack_subaccount_code')
      .in('user_id', taskerIds);

    if (taskerError) throw taskerError;

    const taskerMap = Object.fromEntries(
      taskerRows.map((t) => [t.user_id, t])
    );

    const enrichedTasks = tasks.map((task) => ({
      ...task,
      taskerName: taskerMap[task.tasker_id]?.business_name || 'Unknown Tasker',
      taskerSubaccountCode: taskerMap[task.tasker_id]?.paystack_subaccount_code || null,
    }));

    res.json({ success: true, tasks: enrichedTasks });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error searching tasks' });
  }
});

// ========================================================
// Payment API (Paystack)
// ========================================================

// Initialize a transaction with a subaccount split, and create a pending
// booking record so we have something to update once payment is confirmed
app.post('/api/initialize-transaction', async (req, res) => {
  const { amount, email, taskId, subaccount } = req.body;

  if (!amount || !email || !taskId || !subaccount) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    const customerId = await getUserIdByEmail(email);

    const { data: taskRow, error: taskError } = await supabase
      .from('tasks')
      .select('tasker_id, price')
      .eq('id', taskId)
      .single();
    if (taskError) throw taskError;

    const response = await paystack.post('/transaction/initialize', {
      email,
      amount,
      subaccount,
      metadata: { taskId },
    });

    const { access_code, reference } = response.data.data;

    const { error: bookingError } = await supabase.from('bookings').insert([
      {
        task_id: taskId,
        tasker_id: taskRow.tasker_id,
        customer_id: customerId,
        amount: amount / 100, // convert back from subunits to KES
        payment_reference: reference,
        status: 'pending',
      },
    ]);
    if (bookingError) throw bookingError;

    res.json({ success: true, access_code, reference });
  } catch (error) {
    console.error('Error initializing transaction:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Error initializing payment' });
  }
});

// Verify a transaction directly (used as a fallback/confirmation alongside the webhook)
app.get('/api/verify-transaction/:reference', async (req, res) => {
  const { reference } = req.params;

  try {
    const response = await paystack.get(`/transaction/verify/${reference}`);
    const { status } = response.data.data;

    if (status === 'success') {
      const { error } = await supabase
        .from('bookings')
        .update({ status: 'paid', updated_at: new Date().toISOString() })
        .eq('payment_reference', reference)
        .eq('status', 'pending');

      if (error) console.error('Error updating booking after verify:', error);
    }

    res.json({ success: true, status });
  } catch (error) {
    console.error('Error verifying transaction:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Error verifying payment' });
  }
});

// ========================================================
// Serve React Frontend
// ========================================================
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
});

// Start the server
const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});