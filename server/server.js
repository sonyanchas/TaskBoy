const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const multer = require('multer');
const { ApiError, Client, Environment } = require('square');



const { randomUUID } = require('crypto');
const cors = require('cors');

// const nodemailer = require('nodemailer'); // For confirmation emails

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Initialize Square client

const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: process.env.NODE_ENV === 'production' 
    ? Environment.Production 
    : Environment.Sandbox
});
// Configure email transporter (if using)
/*
const transporter = nodemailer.createTransport({
  // Configure based on your email provider
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});
*/

const app = express();
app.use(express.json());
app.use(cors());

// Set up multer for handling file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Serve static files from React build folder
app.use(express.static(path.join(__dirname, '../client/build')));

// ========================================================
// Authentication Routes using Supabase Auth
// ========================================================

// Registration endpoint using Supabase Auth
app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    console.log(`Received registration request for email: ${email}`);

    // Email validation
    const emailPattern = /@(spelman\.edu|morehouse\.edu)$/;
    if (!emailPattern.test(email)) {
        return res.status(400).json({ success: false, message: 'Email must end with @spelman.edu or @morehouse.edu.' });
    }

    try {
        // Register user in Supabase Auth
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { name } } // Store additional user info
        });

        if (error) throw error;

        res.json({ success: true, message: 'Registration successful. Check your email for verification.' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: error.message || 'Error registering user' });
    }
});

// Login endpoint
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    console.log(`Received login request for email: ${email}`);

    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // Get the user's name from the user metadata
        const name = data.user.user_metadata?.name || 'User';

        res.json({ success: true, message: 'Login successful', name, user: data.user });
    } catch (error) {
        console.error('Login error:', error);
        res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
});

// Email verification using 6-digit code
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
// Clothing Listings API
// ========================================================

// Endpoint to post a new clothing listing
app.post('/listings', upload.single('image'), async (req, res) => {
  const { title, size, itemType, condition, washInstructions, startDate, endDate, pricePerDay, totalPrice } = req.body;
  const { file } = req;
  const userEmail = req.headers['user-id']; 
  
  console.log("Received listing data:", {
      userEmail,
      title,
      size,
      itemType,
      condition,
      washInstructions,
      startDate,
      endDate,
      pricePerDay,
      hasFile: !!file
  });

  if (!userEmail) {
      return res.status(401).json({ success: false, message: 'User authentication required' });
  }

  try {
      // First, get the user UUID from the email
      const { data: authData, error: authError } = await supabase.auth
          .admin.listUsers();
          
      if (authError) {
          console.error("Error listing users:", authError);
          throw authError;
      }
      
      // Find the user with the matching email
      const user = authData.users.find(u => u.email === userEmail);
      
      if (!user) {
          console.error("User not found with email:", userEmail);
          return res.status(404).json({ success: false, message: 'User not found' });
      }
      
      const userId = user.id;
      console.log("Found user ID:", userId);
      
      let imageURL = null;

      if (file) {
          const fileName = `${Date.now()}_${file.originalname}`;
          console.log("Uploading file:", fileName);
          
          const { data: fileData, error: fileError } = await supabase.storage
              .from('clothing-images')
              .upload(fileName, file.buffer, { 
                  contentType: file.mimetype,
                  upsert: true
              });

          if (fileError) {
              console.error("File upload error:", fileError);
              throw fileError;
          }
          
          const { data: publicUrlData } = supabase.storage
              .from('clothing-images')
              .getPublicUrl(fileName);
              
          imageURL = publicUrlData.publicUrl;
          console.log("File uploaded successfully, URL:", imageURL);
      }

      console.log("Attempting insert with UUID:", userId);
      
      const { data, error } = await supabase
          .from('listings')
          .insert([{ 
              user: userId,
              title, 
              size, 
              itemType, 
              condition, 
              washInstructions, 
              startDate, // Changed from dateAvailable 
              endDate,   // Added end date
              pricePerDay, // Changed from price
              imageURL
          }])
          .select();

      if (error) {
          console.error("Supabase error details:", error);
          throw error;
      }
      
      console.log("Insert successful, returned data:", data);
      res.json({ success: true, message: 'Listing posted successfully', listing: data[0] });
  } catch (error) {
      console.error("Full error object:", error);
      res.status(500).json({ success: false, message: error.message || 'Error posting listing' });
  }
});

// Search Listings Endpoint
app.get('/search', async (req, res) => {
  const { query = '' } = req.query;
  console.log(`Received search request for: ${query}`);

  try {
      let dbQuery = supabase
          .from('listings')
          .select('*');
          
      // Only add filter if query is not empty
      if (query.trim()) {
          dbQuery = dbQuery.or(`title.ilike.%${query}%,size.ilike.%${query}%,itemType.ilike.%${query}%,condition.ilike.%${query}%`);
      }

      const { data, error } = await dbQuery;

      if (error) throw error;

      res.json({ success: true, listings: data });
  } catch (error) {
      console.error('Search error:', error);
      res.status(500).json({ success: false, message: error.message || 'Error searching listings' });
  }
});

// ========================================================
// NEW: Rental and Payment API Endpoints
// ========================================================

// Process payment and create rental record
app.post('/api/process-payment', async (req, res) => {
  try {
    const { sourceId, amount, listingId, startDate, endDate, userEmail } = req.body;
    
    if (!sourceId || !amount || !listingId || !startDate || !endDate || !userEmail) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required payment information' 
      });
    }
    
    console.log(`Processing payment: $${amount} for listing ${listingId}`);
    
    // Get user ID from email
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers();
    if (authError) throw authError;
    
    const user = authData.users.find(u => u.email === userEmail);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    const userId = user.id;
    
    // Get listing details
    const { data: listingData, error: listingError } = await supabase
      .from('listings')
      .select('*')
      .eq('id', listingId)
      .single();
      
    if (listingError) throw listingError;
    if (!listingData) {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }
    
    // Create a unique idempotency key for this payment
    const idempotencyKey = randomUUID();
    
    // Convert amount to cents for Square API
    const amountInCents = Math.round(parseFloat(amount) * 100);
    
    // Process the payment with Square
    const payment = await squareClient.paymentsApi.createPayment({
      sourceId,
      idempotencyKey,
      amountMoney: {
        amount: amountInCents,
        currency: 'USD'
      },
      // Add metadata about the transaction
      note: `Rental payment for ${listingData.title}`,
      // Include reference ID for your database
      referenceId: String(listingId)
    });
    
    if (payment.result && payment.result.payment) {
      // Payment was successful
      console.log('Payment successful:', payment.result.payment.id);
      
      // Create rental record in Supabase
      const { data: rentalData, error: rentalError } = await supabase
        .from('rentals')
        .insert([{
          listing_id: listingId,
          renter_id: userId,
          start_date: startDate,
          end_date: endDate,
          total_amount: amount,
          payment_id: payment.result.payment.id,
          status: 'confirmed'
        }])
        .select();
        
      if (rentalError) throw rentalError;
      
      const rentalId = rentalData[0].id;
      
      // Optional: Send confirmation email
      /*
      await sendConfirmationEmail(
        userEmail, 
        listingData, 
        new Date(startDate), 
        new Date(endDate), 
        amount, 
        rentalId
      );
      */
      
      return res.json({ 
        success: true, 
        paymentId: payment.result.payment.id, 
        rentalId 
      });
    } else {
      return res.status(400).json({ 
        success: false, 
        message: 'Payment processing failed' 
      });
    }
  } catch (error) {
    console.error('Payment error:', error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'An error occurred during payment processing' 
    });
  }
});

// Get user's rental history
app.get('/api/rentals', async (req, res) => {
  const userEmail = req.headers['user-id'];
  
  if (!userEmail) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  
  try {
    // Get user ID from email
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers();
    if (authError) throw authError;
    
    const user = authData.users.find(u => u.email === userEmail);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    const userId = user.id;
    
    // Get rentals with listing details
    const { data, error } = await supabase
      .from('rentals')
      .select(`
        *,
        listing:listing_id (
          title, 
          size, 
          itemType, 
          imageURL,
          pricePerDay
        )
      `)
      .eq('renter_id', userId)
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    
    res.json({ success: true, rentals: data });
  } catch (error) {
    console.error('Error fetching rentals:', error);
    res.status(500).json({ success: false, message: error.message || 'Error fetching rental history' });
  }
});

// Helper function to send confirmation email
async function sendConfirmationEmail(email, listing, startDate, endDate, amount, rentalId) {
  try {
    const formattedStartDate = startDate.toLocaleDateString();
    const formattedEndDate = endDate.toLocaleDateString();
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Rental Confirmation - Campus Closet',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Your Rental is Confirmed!</h2>
          <p>Thank you for using Campus Closet. Your rental has been successfully processed.</p>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #2c3e50;">Rental Details</h3>
            <p><strong>Item:</strong> ${listing.title}</p>
            <p><strong>Size:</strong> ${listing.size}</p>
            <p><strong>Rental Period:</strong> ${formattedStartDate} to ${formattedEndDate}</p>
            <p><strong>Total Amount:</strong> $${parseFloat(amount).toFixed(2)}</p>
            <p><strong>Confirmation ID:</strong> ${rentalId}</p>
          </div>
          
          <p>You'll be able to pick up your item on the start date of your rental period.</p>
          <p>If you have any questions, please contact us at support@campuscloset.com.</p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666;">
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </div>
      `
    };
    
    await transporter.sendMail(mailOptions);
    console.log(`Confirmation email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Error sending confirmation email:', error);
    // Don't fail the transaction if email sending fails
    return false;
  }
}

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