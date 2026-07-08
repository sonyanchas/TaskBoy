import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './Dashboard.css'; // Reusing Dashboard styles

function TaskerOnboarding({ email, onComplete }) {
    const [businessName, setBusinessName] = useState('');
    const [bankCode, setBankCode] = useState('');
    const [accountNumber, setAccountNumber] = useState('');
    const [banks, setBanks] = useState([]);
    const [message, setMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Fetch the list of banks from your backend (which proxies Paystack's
    // "List Banks" endpoint) so the Tasker picks from a dropdown instead of
    // typing a bank code they won't know
    useEffect(() => {
        const fetchBanks = async () => {
            try {
                const response = await axios.get('/api/banks?country=kenya');
                setBanks(response.data.banks || []);
            } catch (error) {
                console.error('Error fetching bank list:', error);
                setMessage('❌ Could not load bank list. Please refresh and try again.');
            }
        };
        fetchBanks();
    }, []);

    const handleOnboard = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setMessage('');

        if (!businessName.trim() || !bankCode || !accountNumber.trim()) {
            setMessage('❌ Please fill in all fields.');
            setIsSubmitting(false);
            return;
        }

        try {
            await axios.post(
                '/api/tasker/onboard',
                {
                    businessName,
                    bankCode,
                    accountNumber,
                },
                { headers: { 'user-id': email } }
            );

            setMessage('✅ You\'re all set up to receive payments!');
            setTimeout(() => {
                onComplete();
            }, 1200);
        } catch (error) {
            setMessage(
                '❌ Error setting up payouts: ' +
                    (error.response?.data?.message || error.message)
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="listing-form">
            <h3>Set Up Payouts</h3>
            <p className="payment-hint">
                Before you can list a service, we need your bank details so customer
                payments can be sent to you automatically after each completed task.
            </p>

            <form onSubmit={handleOnboard}>
                <label>Account Holder / Business Name</label>
                <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="E.g., Jane Doe"
                    required
                />

                <label>Bank</label>
                <select
                    value={bankCode}
                    onChange={(e) => setBankCode(e.target.value)}
                    required
                >
                    <option value="">Select your bank...</option>
                    {banks.map((bank) => (
                        <option key={bank.code} value={bank.code}>
                            {bank.name}
                        </option>
                    ))}
                </select>

                <label>Account Number</label>
                <input
                    type="text"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder="Your account number"
                    required
                />

                <button type="submit" disabled={isSubmitting} className={isSubmitting ? "submitting" : ""}>
                    {isSubmitting ? "Setting up..." : "Save & Continue"}
                </button>
            </form>

            {message && (
                <div className={`message ${message.startsWith('❌') ? 'error' : 'success'}`}>
                    {message}
                </div>
            )}
        </div>
    );
}

export default TaskerOnboarding;
