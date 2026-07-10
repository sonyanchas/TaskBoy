import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Dashboard from './Dashboard';
import './App.css';

function App() {
    // ==========================================
    // STATE MANAGEMENT
    // ==========================================
    
    // Original input state variables
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [verificationCode, setVerificationCode] = useState('');
    
    // Application flow state
    const [message, setMessage] = useState('');
    const [isEmailSent, setIsEmailSent] = useState(false);
    const [isVerified, setIsVerified] = useState(false);
    
    // Authentication mode state
    const [authMode, setAuthMode] = useState('register'); // Options: 'register' or 'login'
    
    // Load Square SDK
    useEffect(() => {
        // Only load if not already loaded
        if (!window.Square) {
            const squareScript = document.createElement('script');
            squareScript.src = process.env.NODE_ENV === 'production' 
                ? 'https://web.squarecdn.com/v1/square.js'
                : 'https://sandbox.web.squarecdn.com/v1/square.js';
            squareScript.async = true;
            squareScript.onload = () => {
                console.log('Square SDK loaded successfully');
            };
            squareScript.onerror = () => {
                console.error('Failed to load Square SDK');
            };
            document.head.appendChild(squareScript);
            
            return () => {
                // Clean up on component unmount
                if (document.head.contains(squareScript)) {
                    document.head.removeChild(squareScript);
                }
            };
        }
    }, []);
    
    // Add body class for dashboard view when verified
    useEffect(() => {
        if (isVerified) {
            document.body.classList.add('dashboard-view');
        } else {
            document.body.classList.remove('dashboard-view');
        }
        
        // Cleanup on component unmount
        return () => {
            document.body.classList.remove('dashboard-view');
        };
    }, [isVerified]);
    
    // ==========================================
    // EVENT HANDLERS
    // ==========================================
    
    const handleRegister = async (e) => {
        e.preventDefault();

        // Email validation
       const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(email)) {
            setMessage('Please enter a valid email address.');
            return;
}

        try {
            const response = await axios.post('/register', { name, email, password });
            console.log("Registration API response:", response);
            setMessage(response.data.message || 'Verification code sent to your email!');
            setIsEmailSent(true); // Show verification step
        } catch (error) {
            setMessage('Error during registration: ' + (error.response?.data?.message || error.message));
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        
        try {
            const response = await axios.post('/login', { email, password });
            console.log("Login API response:", response);
            
            if (response.data.success) {
                setName(response.data.name || 'User'); // Use name from response or default to 'User'
                setMessage('Login successful!');
                setIsVerified(true); 
            } else {
                setMessage(response.data.message || 'Login failed. Please check your credentials.');
            }
        } catch (error) {
            setMessage('Error during login: ' + (error.response?.data?.message || error.message));
        }
    };

    const handleVerifyEmail = async () => {
        // Verification via code is not currently used — keep as a no-op placeholder.
        setMessage('Please check your email and click the verification link sent to you.');
    };

    const handleLogout = () => {
        // Reset all states
        setName('');
        setEmail('');
        setPassword('');
        setMessage('');
        setVerificationCode('');
        setIsEmailSent(false);
        setIsVerified(false);
        setAuthMode('login'); // Switch to login mode for next time
    };

    // ==========================================
    // COMPONENT RENDERING FUNCTIONS
    // ==========================================
    
    const renderLoginForm = () => (
        <form onSubmit={handleLogin}>
            <div>
                <label>Email</label>
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                />
            </div>
            <div>
                <label>Password</label>
                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                />
            </div>
            <button type="submit">Login</button>
        </form>
    );

    const renderRegistrationForm = () => (
        <form onSubmit={handleRegister}>
            <div>
                <label>Name</label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                />
            </div>
            <div>
                <label>Email</label>
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="Email"
                />
            </div>
            <div>
                <label>Password</label>
                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                />
            </div>
            <button type="submit">Register</button>
        </form>
    );

    const renderVerificationForm = () => (
        <div className="verification-confirmation">
            <h2>Check your email</h2>
            <p>Please click the verification link we sent to your inbox to activate your account.</p>
            <button onClick={() => { setIsEmailSent(false); setAuthMode('login'); setMessage('You can now log in after verifying via email.'); }}>Back to Login</button>
        </div>
    );

    // ==========================================
    // MAIN RENDER FUNCTION
    // ==========================================
    return (
        <div className={`App ${isVerified ? 'dashboard-mode' : ''}`}>
            {!isVerified ? (
                <>
                    <h1>Welcome to TaskBoy</h1>
                    
                    {isEmailSent ? (
                        renderVerificationForm()
                    ) : (
                        <>
                            <div className="auth-tabs">
                                <button 
                                    className={`tab-btn ${authMode === 'register' ? 'active' : ''}`}
                                    onClick={() => setAuthMode('register')}
                                >
                                    Register
                                </button>
                                <button 
                                    className={`tab-btn ${authMode === 'login' ? 'active' : ''}`}
                                    onClick={() => setAuthMode('login')}
                                >
                                    Login
                                </button>
                            </div>
                            
                            {authMode === 'register' ? renderRegistrationForm() : renderLoginForm()}
                        </>
                    )}
                    
                    {message && <p className="message">{message}</p>}
                </>
            ) : (
                <Dashboard 
                    name={name} 
                    email={email} 
                    onLogout={handleLogout} 
                />
            )}
        </div>
    );
}

export default App;