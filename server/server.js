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
// NEW: Payment API Endpoints
// ========================================================

require("dotenv").config();
const { Stripe } = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const express = require("express");
const app = express();
const router = express.Router();
app.use(express.static("public"));

// // Thin webhook must see the raw body before any JSON/urlencoded parsers run
app.post(
  "/api/thin-webhook",
  express.raw({ type: "application/json" }),
  async (request, response) => {
    // Replace this endpoint secret with your endpoint's unique secret
    // If you are testing with the CLI, find the secret by running 'stripe listen'
    // If you are using an endpoint defined with the API or dashboard, look in your webhook settings
    // at https://dashboard.stripe.com/webhooks
    const thinEndpointSecret = "";
    const signature = request.headers["stripe-signature"];
    let eventNotif;
    try {
      eventNotif = stripe.parseEventNotification(
        request.body,
        signature,
        thinEndpointSecret
      );
    } catch (err) {
      console.log(`⚠️  Webhook signature verification failed.`, err.message);
      return response.sendStatus(400);
    }

    if (eventNotif.type === "v2.account.created") {
      await eventNotif.fetchRelatedObject();
      await eventNotif.fetchEvent();
    } else {
      console.log(`Unhandled event type ${eventNotif.type}.`);
    }

    response.send();
  }
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Create a sample product and return a price for it
router.post("/create-product", async (req, res) => {
  const productName = req.body.productName;
  const productDescription = req.body.productDescription;
  const productPrice = req.body.productPrice;
  const accountId = req.body.accountId; // Get the connected account ID

  try {
    // Create the product on the platform
    const product = await stripe.products.create(
      {
        name: productName,
        description: productDescription,
        metadata: { stripeAccount: accountId }
      }
    );

    // Create a price for the product on the platform
    const price = await stripe.prices.create(
      {
        product: product.id,
        unit_amount: productPrice,
        currency: "usd",
        metadata: { stripeAccount: accountId }
      },
    );

    res.json({
      productName: productName,
      productDescription: productDescription,
      productPrice: productPrice,
      priceId: price.id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a Connected Account
router.post("/create-connect-account", async (req, res) => {
  try {
    // Create a Connect account with the specified controller properties
    const account = await stripe.v2.core.accounts.create({
      display_name: req.body.email,
      contact_email: req.body.email,
      dashboard: "express",
      defaults: {
        responsibilities: {
          fees_collector: "application",
          losses_collector: "application",
        },
      },
      identity: {
        country: "US",
        entity_type: "company",
      },
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: {
                requested: true,
              },
            },
          },
        },
      },
    });

    res.json({ accountId: account.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Account Link for onboarding
router.post("/create-account-link", async (req, res) => {
  const accountId = req.body.accountId;
  try {
    const accountLink = await stripe.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations: ['recipient'],
          refresh_url: 'https://example.com',
          return_url: `https://example.com?accountId=${accountId}`,
        },
      },
    });
    res.json({ url: accountLink.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Connected Account Status
router.get("/account-status/:accountId", async (req, res) => {
  try {
    const account = await stripe.v2.core.accounts.retrieve(
      req.params.accountId,
      {
        include: ['requirements', 'configuration.recipient'],
      }
    );
    const payoutsEnabled = account.configuration?.recipient?.capabilities?.stripe_balance?.payouts?.status === 'active'
    const chargesEnabled = account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === 'active'

    // No pending requirments
    const summaryStatus = account.requirements?.summary?.minimum_deadline?.status
    const detailsSubmitted = !summaryStatus || summaryStatus === 'eventually_due'

    res.json({
      id: account.id,
      payoutsEnabled,
      chargesEnabled,
      detailsSubmitted,
      requirements: account.requirements?.entries,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch products for a specific account
router.get("/products/:accountId", async (req, res) => {
  const { accountId } = req.params;

  try {
    const prices = await stripe.prices.search({
      query: `metadata['stripeAccount']:'${accountId}' AND active:'true'`,
      expand: ["data.product"],
      limit: 100,
    });

    res.json(
      prices.data.map((price) => ({
        id: price.product.id,
        name: price.product.name,
        description: price.product.description,
        price: price.unit_amount,
        priceId: price.id,
        period: price.recurring ? price.recurring.interval : null,
        image: "https://i.imgur.com/6Mvijcm.png",
      }))
    );
  } catch (err) {
    console.error("Error fetching prices:", err);
    res.status(500).json({ error: err.message });
  }
});

// Create checkout session
router.post("/create-checkout-session", async (req, res) => {
  const { priceId, accountId } = req.body;

  // Get the price's type from Stripe
  const price = await stripe.prices.retrieve(priceId);
  const priceType = price.type;
  const mode = priceType === 'recurring' ? 'subscription' : 'payment';

  const session = await stripe.checkout.sessions.create({
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: mode,
    // Defines where Stripe will redirect a customer after successful payment
    success_url: `${process.env.DOMAIN}/done?session_id={CHECKOUT_SESSION_ID}`,
    // Defines where Stripe will redirect if a customer cancels payment
    cancel_url: `${process.env.DOMAIN}`,
    ...(mode === 'subscription' ? {
      subscription_data: {
        transfer_data: {
          destination: accountId,
        },
      },
    } : {
      payment_intent_data: {
        transfer_data: {
          destination: accountId,
        },
      },
    }),
  });

  // Redirect to the Stripe hosted checkout URL
  res.redirect(303, session.url);
});

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (request, response) => {
    let event = request.body;
    // Replace this endpoint secret with your endpoint's unique secret
    // If you are testing with the CLI, find the secret by running 'stripe listen'
    // If you are using an endpoint defined with the API or dashboard, look in your webhook settings
    // at https://dashboard.stripe.com/webhooks
    const endpointSecret = "";

    // Only verify the event if you have an endpoint secret defined.
    // Otherwise use the basic event deserialized with JSON.parse
    if (endpointSecret) {
      const signature = request.headers["stripe-signature"];
      try {
        event = stripe.webhooks.constructEvent(
          request.body,
          signature,
          endpointSecret
        );
      } catch (err) {
        console.log(`⚠️  Webhook signature verification failed.`, err.message);
        return response.sendStatus(400);
      }
    }

    let stripeObject;
    let status;
    // Handle the event
    switch (event.type) {
      case "checkout.session.completed":
        stripeObject = event.data.object;
        status = stripeObject.status;
        console.log(`Checkout Session status is ${status}.`);
        // Then define and call a method to handle the subscription deleted.
        // handleCheckoutSessionCompleted(stripeObject);
        break;
      case "checkout.session.async_payment_failed":
        stripeObject = event.data.object;
        status = stripeObject.status;
        console.log(`Checkout Session status is ${status}.`);
        // Then define and call a method to handle the subscription deleted.
        // handleCheckoutSessionFailed(stripeObject);
        break;

      default:
        // Unexpected event type
        console.log(`Unhandled event type ${event.type}.`);
    }
    // Return a 200 response to acknowledge receipt of the event
    response.send();
  }
);

// Create a login link for the connected account's dashboard
router.post("/create-login-link", async (req, res) => {
  const { accountId } = req.body;
  try {
    const loginLink = await stripe.accounts.createLoginLink(accountId);
    res.json({ url: loginLink.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use("/api", router);

app.listen(4242, () => console.log("Server running on port 4242"));


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