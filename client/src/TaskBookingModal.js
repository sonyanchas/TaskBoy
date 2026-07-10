import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './TaskBookingModal.css';

// `task` might look like:
// {
//   id: 'task_123',
//   title: 'Assemble IKEA bookshelf',
//   description: '...',
//   price: 65.00,                      // in KES, set by the Tasker or a quote/estimate
//   taskerId: 'user_456',
//   taskerName: 'Jane D.',
//   taskerSubaccountCode: 'ACCT_xxxxxxxxxx' // Tasker's Paystack subaccount
// }

const PAYSTACK_SCRIPT_URL = 'https://js.paystack.co/v2/inline.js';

function TaskBookingModal({ task, onClose, userEmail }) {
  const [accessCode, setAccessCode] = useState(null);
  const [reference, setReference] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState('initial'); // initial, ready, processing, success, error
  const [errorMessage, setErrorMessage] = useState('');
  const scriptLoadedRef = useRef(false);

  // Step 1: load the Paystack Inline script once.
  // Note: intentionally no cleanup/removal of the script tag — see Dashboard.jsx
  // for why removing it on unmount causes an opaque cross-origin Script error
  // under React Strict Mode's double-invoke of effects in development.
  useEffect(() => {
    if (window.PaystackPop) {
      scriptLoadedRef.current = true;
      return;
    }
    if (document.querySelector('script[data-paystack]')) {
      // Already injected (e.g. by Dashboard) — just wait for it to finish loading
      const checkLoaded = setInterval(() => {
        if (window.PaystackPop) {
          scriptLoadedRef.current = true;
          clearInterval(checkLoaded);
        }
      }, 100);
      return () => clearInterval(checkLoaded);
    }
    const script = document.createElement('script');
    script.src = PAYSTACK_SCRIPT_URL;
    script.async = true;
    script.dataset.paystack = 'true';
    script.onload = () => {
      scriptLoadedRef.current = true;
    };
    script.onerror = () => {
      setErrorMessage('Could not load payment provider. Please refresh and try again.');
    };
    document.body.appendChild(script);
  }, []);

  // Step 2: ask the backend to initialize the transaction (this is where
  // the subaccount split + amount get locked in server-side, so the
  // client can't tamper with the price before paying)
    useEffect(() => {
    if (task && task.price !== undefined && task.price !== null) {
      initializeTransaction();
    }
  }, []);

  const initializeTransaction = async () => {
    try {
      // Ensure the Tasker has a valid subaccount code before contacting backend.
      // Paystack will reject invalid subaccount values; surface a clear message
      // to the user instead of attempting the call.
      const subaccount = task?.taskerSubaccountCode;
      if (!subaccount || typeof subaccount !== 'string') {
        setErrorMessage('This Tasker has not set up payouts yet; payment cannot be initialized.');
        return;
      }
      // Ensure price is a number (some tasks come from the DB as strings)
      const priceNum = Number(task.price);
      if (Number.isNaN(priceNum)) throw new Error('Invalid task price');

      const response = await axios.post('/api/initialize-transaction', {
        amount: Math.round(priceNum * 100), // Paystack expects the amount in kobo/subunits
        email: userEmail,
        taskId: task.id,
        subaccount: task.taskerSubaccountCode,
      });

      setAccessCode(response.data.access_code);
      setReference(response.data.reference);
      setPaymentStatus('ready');
    } catch (error) {
      // Surface Paystack/backend messages when available to aid troubleshooting.
      const serverMessage = error?.response?.data?.message || error?.message;
      setErrorMessage(serverMessage || 'Could not initialize payment. Please try again.');
      console.error('initializeTransaction error:', error?.response || error?.message || error);
    }
  };

  const handlePayment = () => {
    if (!scriptLoadedRef.current || !window.PaystackPop) {
      setErrorMessage('Payment provider is still loading. Please wait a moment.');
      return;
    }
    if (!accessCode) {
      setErrorMessage('Payment session not ready yet. Please wait a moment.');
      return;
    }

    setPaymentStatus('processing');
    setErrorMessage('');

    // resumeTransaction re-opens the exact transaction created on the backend
    // (via its access_code), so the amount/subaccount can't be changed client-side
    const popup = new window.PaystackPop();
    popup.resumeTransaction(accessCode, {
      onSuccess: (transaction) => {
        // Treat this as "payment submitted" — the source of truth for whether
        // it actually succeeded is your backend's charge.success webhook.
        verifyTransaction(transaction.reference || reference);
      },
      onCancel: () => {
        setPaymentStatus('ready');
      },
      onError: (error) => {
        setPaymentStatus('error');
        setErrorMessage(error?.message || 'Payment failed. Please try again.');
      },
    });
  };

  // Confirm with your own backend that the webhook actually landed and the
  // charge was verified server-side, rather than trusting the client callback alone
  const verifyTransaction = async (ref) => {
    try {
      const response = await axios.get(`/api/verify-transaction/${ref}`);
      if (response.data.status === 'success') {
        setPaymentStatus('success');
      } else {
        setPaymentStatus('error');
        setErrorMessage('Payment could not be confirmed. Please contact support.');
      }
    } catch (error) {
      setPaymentStatus('error');
      setErrorMessage('Payment could not be confirmed. Please contact support.');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose}>×</button>

        <div className="modal-details">
          <h2>{task.title}</h2>
          <p className="task-description">{task.description}</p>
          <p><strong>Tasker:</strong> {task.taskerName}</p>
          <p className="task-price"><strong>Price:</strong> KES {(Number(task.price) || 0).toFixed(2)}</p>

          {paymentStatus !== 'success' && (
            <div className="payment-section">
              <p className="payment-hint">
                You can pay by card or M-Pesa on the next screen.
              </p>

              <button
                onClick={handlePayment}
                className="pay-button"
                disabled={paymentStatus === 'processing' || paymentStatus === 'initial' || !!errorMessage}
              >
                {paymentStatus === 'processing'
                  ? 'Processing...'
                  : paymentStatus === 'initial'
                  ? 'Loading...'
                  : 'Pay & Book Task'}
              </button>

              {errorMessage && (
                <div className="error-message">{errorMessage}</div>
              )}
            </div>
          )}

          {paymentStatus === 'success' && (
            <div className="success-message">
              <h3>Task Booked!</h3>
              <p>{task.taskerName} has been notified and will be in touch to schedule.</p>
              <button onClick={onClose} className="close-success-btn">Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TaskBookingModal;
