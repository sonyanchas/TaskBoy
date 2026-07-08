import React, { useState, useEffect } from 'react';
import axios from 'axios';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './Dashboard.css'; // Reusing Dashboard styles

function PostListingForm({ email, onClose }) {
    const [title, setTitle] = useState('');
    const [size, setSize] = useState('S');
    const [itemType, setItemType] = useState('jeans');
    const [condition, setCondition] = useState('');
    const [washInstructions, setWashInstructions] = useState('');
    const [startDate, setStartDate] = useState(null);
    const [endDate, setEndDate] = useState(null);
    const [pricePerDay, setPricePerDay] = useState('');
    const [totalPrice, setTotalPrice] = useState(0);
    const [image, setImage] = useState(null);
    const [message, setMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [previewUrl, setPreviewUrl] = useState('');

    // Calculate total price when relevant inputs change
    useEffect(() => {
        if (startDate && endDate && pricePerDay) {
            const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
            setTotalPrice(days * parseFloat(pricePerDay));
        } else {
            setTotalPrice(0);
        }
    }, [startDate, endDate, pricePerDay]);
    
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

    const handlePostListing = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setMessage('');

        if (!startDate || !endDate) {
            setMessage('Please select both start and end dates');
            setIsSubmitting(false);
            return;
        }
        
        if (!image) {
            setMessage('Please upload an image of your item');
            setIsSubmitting(false);
            return;
        }
        
        if (!pricePerDay || isNaN(parseFloat(pricePerDay)) || parseFloat(pricePerDay) <= 0) {
            setMessage('Please enter a valid price per day');
            setIsSubmitting(false);
            return;
        }

        const formData = new FormData();
        formData.append('title', title);
        formData.append('size', size);
        formData.append('itemType', itemType);
        formData.append('condition', condition);
        formData.append('washInstructions', washInstructions);
        formData.append('startDate', startDate.toISOString());
        formData.append('endDate', endDate.toISOString());
        formData.append('pricePerDay', pricePerDay);
        formData.append('totalPrice', totalPrice);
        if (image) formData.append('image', image);

        try {
            await axios.post('/listings', formData, {
                headers: { 'Content-Type': 'multipart/form-data', 'user-id': email }
            });
            setMessage('✅ Listing posted successfully!');
            // Reset form
            setTitle('');
            setCondition('');
            setWashInstructions('');
            setStartDate(null);
            setEndDate(null);
            setPricePerDay('');
            setTotalPrice(0);
            setImage(null);
            setPreviewUrl('');
            
            // Close form after delay
            setTimeout(() => {
                onClose();
            }, 1500);
        } catch (error) {
            setMessage('❌ Error posting listing: ' + (error.response?.data?.message || error.message));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="listing-form">
            <h3>Post a Clothing Listing</h3>
            
            <form onSubmit={handlePostListing}>
                <label>Title</label>
                <input 
                    type="text" 
                    value={title} 
                    onChange={(e) => setTitle(e.target.value)} 
                    placeholder="E.g., Black Formal Dress"
                    required 
                />

                <label>Size</label>
                <select value={size} onChange={(e) => setSize(e.target.value)}>
                    <option value="XS">XS</option>
                    <option value="S">S</option>
                    <option value="M">M</option>
                    <option value="L">L</option>
                    <option value="XL">XL</option>
                    <option value="XXL">XXL</option>
                </select>

                <label>Item Type</label>
                <select value={itemType} onChange={(e) => setItemType(e.target.value)}>
                    <option value="jeans">Jeans</option>
                    <option value="dress">Dress</option>
                    <option value="skirt">Skirt</option>
                    <option value="pants">Pants</option>
                    <option value="sweater">Sweater</option>
                    <option value="shirt">Shirt</option>
                    <option value="jacket">Jacket</option>
                    <option value="blazer">Blazer</option>
                    <option value="formal">Formal Wear</option>
                    <option value="accessories">Accessories</option>
                    <option value="other">Other</option>
                </select>

                <label>Condition</label>
                <select value={condition} onChange={(e) => setCondition(e.target.value)} required>
                    <option value="">Select condition...</option>
                    <option value="New with tags">New with tags</option>
                    <option value="Like new">Like new</option>
                    <option value="Good">Good</option>
                    <option value="Fair">Fair</option>
                </select>

                <label>Wash Instructions</label>
                <input 
                    type="text" 
                    value={washInstructions} 
                    onChange={(e) => setWashInstructions(e.target.value)} 
                    placeholder="E.g., Machine wash cold"
                    required 
                />

                <label>Available From</label>
                <DatePicker 
                    selected={startDate} 
                    onChange={(date) => setStartDate(date)} 
                    selectsStart 
                    startDate={startDate} 
                    endDate={endDate} 
                    minDate={new Date()}
                    placeholderText="Select start date"
                    className="date-input"
                />

                <label>Available Until</label>
                <DatePicker 
                    selected={endDate} 
                    onChange={(date) => setEndDate(date)} 
                    selectsEnd 
                    startDate={startDate} 
                    endDate={endDate} 
                    minDate={startDate || new Date()}
                    placeholderText="Select end date"
                    className="date-input"
                />

                <label>Price per day ($)</label>
                <input 
                    type="number" 
                    value={pricePerDay} 
                    onChange={(e) => setPricePerDay(e.target.value)} 
                    min="0.01" 
                    step="0.01"
                    placeholder="E.g., 4.99"
                    required 
                />

                {totalPrice > 0 && (
                    <p className="total-price">
                        Total Price for {Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1} days: 
                        <span>${totalPrice.toFixed(2)}</span>
                    </p>
                )}

                <label>Upload Image</label>
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
                    {isSubmitting ? "Posting..." : "Post Listing"}
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

export default PostListingForm;