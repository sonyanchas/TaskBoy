import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './Dashboard.css'; // Reusing Dashboard styles

function PostTaskForm({ email, onClose }) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState('cleaning');
    const [location, setLocation] = useState('');
    const [price, setPrice] = useState('');
    const [image, setImage] = useState(null);
    const [message, setMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [previewUrl, setPreviewUrl] = useState('');

    // Reset message after 5 seconds
    useEffect(() => {
        if (message) {
            const timer = setTimeout(() => {
                setMessage('');
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [message]);

    // Generate image preview when file is selected
    useEffect(() => {
        if (image) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setPreviewUrl(reader.result);
            };
            reader.readAsDataURL(image);
        } else {
            setPreviewUrl('');
        }
    }, [image]);

    const handlePostTask = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setMessage('');

        if (!location.trim()) {
            setMessage('❌ Please enter a location for this service');
            setIsSubmitting(false);
            return;
        }

        if (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
            setMessage('❌ Please enter a valid price');
            setIsSubmitting(false);
            return;
        }

        const formData = new FormData();
        formData.append('title', title);
        formData.append('description', description);
        formData.append('category', category);
        formData.append('location', location);
        formData.append('price', price);
        if (image) formData.append('image', image);

        // Note: we don't send taskerName/taskerSubaccountCode from the client.
        // The backend looks those up from the logged-in Tasker's profile
        // (via the 'user-id' header) and attaches them server-side, so a
        // customer can never be shown a listing with no way to pay the Tasker.
        try {
            await axios.post('/tasks', formData, {
                headers: { 'Content-Type': 'multipart/form-data', 'user-id': email }
            });
            setMessage('✅ Service listed successfully!');
            // Reset form
            setTitle('');
            setDescription('');
            setLocation('');
            setPrice('');
            setImage(null);
            setPreviewUrl('');

            // Close form after delay
            setTimeout(() => {
                onClose();
            }, 1500);
        } catch (error) {
            // If the backend rejects because this Tasker hasn't onboarded yet
            // (no subaccount on file), surface that clearly rather than a
            // generic error, since the fix is different (go set up payouts).
            if (error.response?.status === 412) {
                setMessage('❌ You need to set up payouts before listing a service.');
            } else {
                setMessage('❌ Error posting service: ' + (error.response?.data?.message || error.message));
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="listing-form">
            <h3>List a Service</h3>

            <form onSubmit={handlePostTask}>
                <label>Title</label>
                <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="E.g., Furniture Assembly"
                    required
                />

                <label>Category</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="cleaning">Cleaning</option>
                    <option value="moving">Moving & Delivery</option>
                    <option value="handyman">Handyman</option>
                    <option value="furniture-assembly">Furniture Assembly</option>
                    <option value="gardening">Gardening</option>
                    <option value="tutoring">Tutoring</option>
                    <option value="errands">Errands</option>
                    <option value="tech-help">Tech Help</option>
                    <option value="other">Other</option>
                </select>

                <label>Description</label>
                <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe what's included in this service"
                    rows={4}
                    required
                />

                <label>Location / Service Area</label>
                <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="E.g., Kilimani, Nairobi"
                    required
                />

                <label>Price (KES)</label>
                <input
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    min="1"
                    step="1"
                    placeholder="E.g., 1500"
                    required
                />

                <label>Upload a Photo (optional)</label>
                <div className="file-upload-container">
                    <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => setImage(e.target.files[0])}
                        className="file-input"
                    />

                    {previewUrl && (
                        <div className="image-preview">
                            <img src={previewUrl} alt="Preview" />
                        </div>
                    )}
                </div>

                <button
                    type="submit"
                    disabled={isSubmitting}
                    className={isSubmitting ? "submitting" : ""}
                >
                    {isSubmitting ? "Posting..." : "List Service"}
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

export default PostTaskForm;
