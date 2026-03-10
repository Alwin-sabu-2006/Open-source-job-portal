// routes/authRoutes.js
const express = require('express');
const User = require('../models/user');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const router = express.Router();

// --- Multer Configuration for File Uploads ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // The destination folder for uploads
        cb(null, 'uploads/documents/');
    },
    filename: function (req, file, cb) {
        // Create a unique filename to prevent overwriting
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Show registration form
router.get('/register', (req, res) => {
    res.locals.title = 'Register';
    res.render('register');
});

// Handle registration form submission
router.post(
    '/register',
    // --- Validation middleware ---
    body('email', 'Please enter a valid email').isEmail().normalizeEmail(),
    body('name', 'Name is required').not().isEmpty().trim().escape(),
    body('password', 'Password must be at least 6 characters long').isLength({ min: 6 }),
    // Conditional validation for employer fields
    body('companyName').if(body('role').equals('employer')).not().isEmpty().withMessage('Company Name is required for employers.'),
    body('companyWebsite').if(body('role').equals('employer')).isURL().withMessage('A valid Company Website is required for employers.'),
    body('jobTitle').if(body('role').equals('employer')).not().isEmpty().withMessage('Job Title is required for employers.'),
    body('companyAddress').if(body('role').equals('employer')).not().isEmpty().withMessage('Company Address is required for employers.'),
    body('contactPhone').if(body('role').equals('employer')).not().isEmpty().withMessage('Contact Phone is required for employers.'),
    // --- End of validation ---
    async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            // If there are validation errors, re-render the form with the errors
            return res.render('register', {
                title: 'Register',
                error: errors.array()[0].msg, // Show the first error message
                // Pass the submitted data back to repopulate the form
                oldInput: req.body
            });
        }

        const { name, password, role, companyName, companyWebsite, jobTitle, companyAddress, contactPhone } = req.body;
        const email = req.body.email.toLowerCase(); // Normalize email to lowercase

        // 1. Check if user already exists
        const existingUser = await User.findOne({ email: email });
        if (existingUser) {
            // If user exists, re-render the form with an error message
            return res.render('register', {
                title: 'Register',
                error: 'An account with this email already exists.',
                oldInput: req.body
            });
        }

        // 2. If not, create and save the new user
        const user = new User({
            name,
            email,
            role,
            companyName: role === 'employer' ? companyName : undefined,
            companyWebsite: role === 'employer' ? companyWebsite : undefined,
            jobTitle: role === 'employer' ? jobTitle : undefined,
            companyAddress: role === 'employer' ? companyAddress : undefined,
            contactPhone: role === 'employer' ? contactPhone : undefined,
            password: password // Pass the plain password, the model will hash it
        });

        // Explicitly set verification status based on role
        if (role === 'employer') {
            user.verificationStatus = 'pending';
        } else {
            // 'job_seeker' roles are auto-verified
            user.verificationStatus = 'verified';
        }

        await user.save();
        
        if (user.role === 'employer') {
            req.flash('success', 'Registration successful! Your account has been submitted for approval.');
        } else {
            req.flash('success', 'Registration successful! You can now log in.');
        }

        res.redirect('/auth/login');
    } catch (error) {
        console.error(error);
        res.render('register', {
            title: 'Register',
            error: 'Failed to register. Please try again.',
            oldInput: req.body
        });
    }
});

// --- Login Routes ---

// Show login form
router.get('/login', (req, res) => {
    res.locals.title = 'Login';
    res.render('login', { error: null });
});

// Handle login form submission
router.post('/login', async (req, res) => {
    try {
        const { password } = req.body;
        const email = req.body.email.toLowerCase(); // Normalize email to lowercase

        // 1. Find the user by email
        const user = await User.findOne({ email: email });
        if (!user) {
            return res.render('login', { title: 'Login', error: 'Invalid email or password.' }); // Error case
        }

        // 2. Compare the submitted password with the stored hash
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.render('login', { title: 'Login', error: 'Invalid email or password.' }); // Error case
        }

        // 3. Store user info in session to keep them logged in
        req.session.user = {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            verificationStatus: user.verificationStatus
        };

        // Redirect based on user role
        if (user.role === 'employer') {
            if (user.verificationStatus === 'verified') {
                req.flash('success', 'You have successfully logged in.');
                res.redirect('/jobs/dashboard');
            } else if (user.verificationStatus === 'pending') {
                req.flash('success', 'Login successful. Your account is pending approval.');
                res.redirect('/jobs/dashboard');
            } else if (user.verificationStatus === 'frozen') {
                req.flash('error', 'Your account has been suspended. Please contact support.');
                res.redirect('/auth/login');
            } else if (user.verificationStatus === 'banned') {
                req.flash('error', `Your account has been banned. Reason: ${user.banReason || 'Violation of terms.'}`);
                res.redirect('/auth/login');
            } else {
                // 'rejected'
                req.flash('error', 'Your account has been rejected. Please contact support for more information.');
                res.redirect('/auth/login');
            }
        } else if (user.role === 'admin') {
            req.flash('success', 'Successfully authorized as admin.');
            res.redirect('/admin/dashboard');
        } else if (user.verificationStatus === 'frozen') { // For job_seeker and others
            req.flash('error', 'Your account has been suspended. Please contact support.');
            res.redirect('/auth/login');
        } else if (user.verificationStatus === 'banned') {
            req.flash('error', `Your account has been banned. Reason: ${user.banReason || 'Violation of terms.'}`);
            res.redirect('/auth/login');
        } else { // For 'job_seeker'
            req.flash('success', 'You have successfully logged in.');
            res.redirect('/jobs');
        }
    } catch (error) {
        console.error(error);
        res.render('login', { title: 'Login', error: 'An error occurred. Please try again.' }); // Error case
    }
});

// --- Logout Route ---
router.get('/logout', (req, res) => {
    // Use regenerate to destroy the old session and create a new one
    // This allows us to store a flash message for the redirect
    req.session.regenerate((err) => {
        if (err) {
            console.error('Error regenerating session:', err);
            return res.redirect('/');
        }
        req.flash('success', 'You have been logged out successfully.');
        req.session.save((err) => {
            if (err) console.error('Error saving session:', err);
            res.redirect('/');
        });
    });
});

module.exports = router;
