const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
// Load environment variables: root .env first, then server/.env overrides if present.
const dotenv = require('dotenv');
const rootEnvPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: rootEnvPath });
dotenv.config({ path: path.join(__dirname, '.env') });
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

// Email sending has been disabled. Removed SMTP/nodemailer support to simplify
// local development and avoid requiring domain verification for transactional
// email providers. Notification points below now log intents instead of sending.

async function getUserById(userId) {
  try {
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) throw error;
    return data.users.find((u) => u.id === userId) || null;
  } catch (err) {
    console.error('getUserById error:', err);
    return null;
  }
}

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
        // since Paystack may retry webhook delivery. Return the updated row.
        const { data: updatedBooking, error } = await supabase
          .from('bookings')
          .update({ status: 'paid', updated_at: new Date().toISOString() })
          .eq('payment_reference', reference)
          .eq('status', 'pending')
          .select()
          .single();

        if (error) {
          console.error('Error updating booking from webhook:', error);
        } else if (updatedBooking) {
          try {
            const customer = await getUserById(updatedBooking.customer_id);
            const tasker = await getUserById(updatedBooking.tasker_id);

            if (customer?.email) {
              console.log('Email disabled: would notify customer', customer.email, 'about paid booking', updatedBooking.id);
            }

            if (tasker?.email) {
              console.log('Email disabled: would notify tasker', tasker.email, 'about paid booking', updatedBooking.id);
            }
          } catch (notifyErr) {
            console.error('Error sending booking confirmation emails:', notifyErr);
          }
        }
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
      // Use the Admin API (service role key) to create the user server-side.
      // This avoids client-side signUp fetch paths and works from trusted servers.
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        user_metadata: { name },
        // Auto-confirm for local/dev convenience so the user can login immediately.
        email_confirm: true,
      });

      if (error) throw error;

      res.json({ success: true, message: 'Registration created. Please check your email to verify the account if verification is enabled.' });
    } catch (error) {
        console.error('Registration error:', error);
         // Provide a clearer message for debugging while avoiding sensitive data.
         const msg = (error && (error.message || error.toString())) || 'Error registering user';
         const statusCode = error && error.status && Number.isInteger(error.status) ? error.status : 500;
         res.status(statusCode).json({ success: false, message: msg });
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
         const msg = (error && (error.message || error.toString())) || 'Invalid email or password';
         const statusCode = error && error.status && Number.isInteger(error.status) ? error.status : 401;
         res.status(statusCode).json({ success: false, message: msg });
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
         const msg = (error && (error.message || error.toString())) || 'Error verifying email';
         const statusCode = error && error.status && Number.isInteger(error.status) ? error.status : 500;
         res.status(statusCode).json({ success: false, message: msg });
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

    const { data: bookingData, error: bookingError } = await supabase
      .from('bookings')
      .insert([
        {
          task_id: taskId,
          tasker_id: taskRow.tasker_id,
          customer_id: customerId,
          amount: amount / 100, // convert back from subunits to KES
          payment_reference: reference,
          status: 'pending',
        },
      ])
      .select()
      .single();

    if (bookingError) throw bookingError;

    // Send a notification email to the customer that the booking was created
    // Email sending disabled — log the intent instead of sending an email
    console.log('Email disabled: would notify', email, 'that booking', bookingData.id || '(unknown)', 'is pending payment with reference', reference);

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