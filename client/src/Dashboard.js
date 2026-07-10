import React, { useState, useEffect } from 'react';
import axios from 'axios';
import PostTaskForm from './PostTaskForm';
import TaskBookingModal from './TaskBookingModal';
import TaskerOnboarding from './TaskerOnboarding';
import './Dashboard.css';

function Dashboard({ name, email, onLogout }) {
    const [showForm, setShowForm] = useState(false);
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [isOnboarded, setIsOnboarded] = useState(null); // null = unknown/loading
    const [tasks, setTasks] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [filteredResults, setFilteredResults] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedTask, setSelectedTask] = useState(null);

    const fetchTasks = async (query = '') => {
        setIsLoading(true);
        try {
            const response = await axios.get(`/tasks/search?query=${encodeURIComponent(query)}`);
            setTasks(response.data.tasks || []);
            setFilteredResults(response.data.tasks || []);
            setError('');
        } catch (error) {
            console.error('Error fetching tasks:', error);
            setError('Failed to load tasks. Please try again later.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchTasks();
    }, []);

    // Check whether this user has already onboarded as a Tasker (i.e. has a
    // Paystack subaccount on file). This determines whether "List a Service"
    // goes straight to the form or to onboarding first.
    useEffect(() => {
        const fetchOnboardingStatus = async () => {
            try {
                const response = await axios.get('/api/tasker/status', {
                    headers: { 'user-id': email }
                });
                setIsOnboarded(!!response.data.onboarded);
            } catch (error) {
                console.error('Error checking onboarding status:', error);
                setIsOnboarded(false);
            }
        };
        fetchOnboardingStatus();
    }, [email]);

    // Handle search
    useEffect(() => {
        if (!searchQuery.trim()) {
            setFilteredResults(tasks);
            return;
        }

        const filtered = tasks.filter(task =>
            task.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            task.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            task.location?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            task.description?.toLowerCase().includes(searchQuery.toLowerCase())
        );

        setFilteredResults(filtered);
    }, [searchQuery, tasks]);

    const handleTaskClick = (task) => {
        setSelectedTask(task);
    };

    const handleCloseModal = () => {
        setSelectedTask(null);
    };

    // Decide what happens when "List a Service" / "Cancel" is clicked
    const handleListServiceClick = () => {
        if (showForm || showOnboarding) {
            setShowForm(false);
            setShowOnboarding(false);
            return;
        }
        if (isOnboarded) {
            setShowForm(true);
        } else {
            setShowOnboarding(true);
        }
    };

    // Load Paystack Inline SDK once when the component mounts
    useEffect(() => {
        if (!window.PaystackPop) {
            const script = document.createElement('script');
            script.src = 'https://js.paystack.co/v1/inline.js';
            script.async = true;
            script.onload = () => {
                console.log('Paystack SDK loaded');
            };
            script.onerror = () => {
                console.error('Failed to load Paystack SDK');
            };
            document.body.appendChild(script);

            return () => {
                document.body.removeChild(script);
            };
        }
    }, []);

    const renderPlaceholderContent = () => {
        const placeholders = [
            {
                id: 'placeholder-1',
                title: 'Assemble IKEA Bookshelf',
                category: 'furniture-assembly',
                location: 'Kilimani, Nairobi',
                price: '1500.00',
                imageURL: 'https://via.placeholder.com/300x200?text=Furniture+Assembly',
                description: 'PAX wardrobe or bookshelf assembly, tools included.'
            },
            {
                id: 'placeholder-2',
                title: 'Deep Clean 2-Bedroom Apartment',
                category: 'cleaning',
                location: 'Westlands, Nairobi',
                price: '3000.00',
                imageURL: 'https://via.placeholder.com/300x200?text=Cleaning',
                description: 'Full deep clean including kitchen and bathrooms.'
            },
            {
                id: 'placeholder-3',
                title: 'Help Moving Furniture',
                category: 'moving',
                location: 'Karen, Nairobi',
                price: '2000.00',
                imageURL: 'https://via.placeholder.com/300x200?text=Moving',
                description: 'An extra pair of hands for moving heavy items.'
            }
        ];

        return (
            <div className="listings-grid">
                {placeholders.map((item) => (
                    <div
                        key={item.id}
                        className="listing-card"
                        onClick={() => handleTaskClick(item)}
                    >
                        <img src={item.imageURL} alt={item.title} />
                        <div className="listing-info">
                            <h3>{item.title}</h3>
                            <p><strong>Category:</strong> {item.category}</p>
                            <p><strong>Location:</strong> {item.location}</p>
                            <p><strong>KES {item.price}</strong></p>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="dashboard">
            <h2>Welcome, {name}!</h2>

            {/* Search Bar */}
            <div className="search-section">
                <input
                    type="text"
                    placeholder="Search by title, category, location..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>

            {/* Toggle Post Service Form / Onboarding */}
            <button className="post-listing-btn" onClick={handleListServiceClick}>
                {(showForm || showOnboarding) ? "Cancel" : "List a Service"}
            </button>

            {/* Route to onboarding first if this Tasker hasn't set up payouts yet */}
            {showOnboarding && (
                <TaskerOnboarding
                    email={email}
                    onComplete={() => {
                        setIsOnboarded(true);
                        setShowOnboarding(false);
                        setShowForm(true);
                    }}
                />
            )}

            {showForm && (
                <PostTaskForm
                    email={email}
                    onClose={() => setShowForm(false)}
                    onTaskPosted={() => fetchTasks(searchQuery)}
                />
            )}

            {/* Tasks Grid */}
            {!showForm && !showOnboarding && (
                <>
                    {isLoading ? (
                        <p className="status-message">Loading tasks...</p>
                    ) : error ? (
                        <div className="error-container">
                            <p className="error-message">{error}</p>
                            {renderPlaceholderContent()}
                        </div>
                    ) : filteredResults.length > 0 ? (
                        <div className="listings-grid">
                            {filteredResults.map((task) => (
                                <div
                                    key={task.id}
                                    className="listing-card"
                                    onClick={() => handleTaskClick(task)}
                                >
                                    <img
                                        src={task.imageURL || "https://via.placeholder.com/300x200?text=No+Image"}
                                        alt={task.title}
                                    />
                                    <div className="listing-info">
                                        <h3>{task.title}</h3>
                                        <p><strong>Category:</strong> {task.category}</p>
                                        <p><strong>Location:</strong> {task.location}</p>
                                        <p><strong>KES {task.price}</strong></p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : searchQuery ? (
                        <p className="status-message">No tasks matching "{searchQuery}" found.</p>
                    ) : (
                        <div>
                            <p className="status-message">No services listed yet. Be the first!</p>
                            {renderPlaceholderContent()}
                        </div>
                    )}
                </>
            )}

            {/* Task Booking Modal */}
            {selectedTask && (
                <TaskBookingModal
                    task={selectedTask}
                    onClose={handleCloseModal}
                    userEmail={email}
                />
            )}

            {/* Logout Button */}
            <button className="logout-btn" onClick={onLogout}>Log Out</button>
        </div>
    );
}

export default Dashboard;
