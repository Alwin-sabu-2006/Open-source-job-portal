// d:\Open source JOB PORTAL\job-portal\server.js

// 1. Import necessary packages
const path = require('path'); // Import the 'path' module
require('dotenv').config(); // .env will be found in the current directory

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const flash = require('connect-flash'); // 1. Import connect-flash
const methodOverride = require('method-override');

// Import your route files
const authRoutes = require('./routes/authRoutes');
const jobsRouter = require('./routes/jobs'); // Use the correct jobs router
const adminRoutes = require('./routes/adminRoutes'); // Correctly import admin routes
const Job = require('./models/job'); // Import the Job model (used in some routes)

// 2. Initialize the Express app
const app = express();
const PORT = process.env.PORT || 3000;

// 3. Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB connected successfully.'))
    .catch(err => console.error('MongoDB connection error:', err));

// 4. Set up Middleware
// This allows our app to parse form data
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
// This tells Express to serve static files (like CSS) from the 'public' directory
app.use(express.static('public'));
// Serve uploaded files statically so they can be viewed
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Set EJS as the view engine and explicitly set the views directory using an absolute path
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// 5. Set up session management
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true }, // Session cookie: expires when browser is closed
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI,
        collectionName: 'sessions'
    })
}));

// 6. Initialize flash middleware
app.use(flash());

// 7. Global middleware to pass session data and flash messages to all templates
// This MUST come before the route definitions
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.isLanding = false;
    res.locals.title = 'Job Portal'; // Set a default title
    res.locals.success_msg = req.flash('success');
    res.locals.error_msg = req.flash('error');
    next();
});

// 8. Define Routes
// Homepage route
app.get('/', (req, res) => {
    res.locals.title = 'Welcome to Careerio';
    res.locals.isLanding = true;
    res.render('landing');
});

// Use the authentication routes
app.use('/auth', authRoutes);

// Use the job routes
app.use('/jobs', jobsRouter);

// Use the admin routes
app.use('/admin', adminRoutes);

// 9. Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
