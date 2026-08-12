import React from 'react';
import './Navbar.css';

function Navbar({ userName, onLogout, onNavigate }) {
  return (
    <nav className="navbar">
      <div className="navbar-container">
        <div className="navbar-left">
          <h1 className="navbar-brand">TaskBoy</h1>
        </div>
        
        <div className="navbar-center">
          <button className="nav-link" onClick={() => onNavigate('home')}>
            Home
          </button>
          <button className="nav-link" onClick={() => onNavigate('profile')}>
            Profile
          </button>
        </div>

        <div className="navbar-right">
          <span className="user-info">Welcome, {userName}!</span>
          <button className="logout-btn" onClick={onLogout}>
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
