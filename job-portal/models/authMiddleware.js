// middleware/authMiddleware.js

const isLoggedIn = (req, res, next) => {
    if (!req.session.user) {
        req.flash('error', 'Please log in to view that resource.');
        return res.redirect('/auth/login');
    }
    next();
};

const isEmployer = (strict = false) => async (req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'employer') {
        req.flash('error', 'Access Denied. You must be logged in as an employer.');
        return res.redirect('/auth/login');
    }

    // For strict checks (like posting a job), the user MUST be verified.
    if (strict && req.session.user.verificationStatus !== 'verified') {
        req.flash('error', 'Your employer account must be verified to perform this action.');
        return res.redirect('/jobs/dashboard'); // Redirect to dashboard where they see the pending status
    }

    // For non-strict checks (like viewing the dashboard), pending or verified is okay.
    if (req.session.user.verificationStatus === 'rejected') {
        req.flash('error', 'Your account has been rejected. Please contact support.');
        return res.redirect('/');
    }

    // If we pass all checks, proceed.
    next();
};

const isAdmin = async (req, res, next) => {
    // Perform a direct database check for the most reliable authorization
    try {
        const user = await require('./user').findById(req.session.user.id);
        if (user && user.role === 'admin' && user.verificationStatus === 'verified') {
            return next();
        }
        req.flash('error', 'You do not have permission to view this page.');
        res.redirect('/');
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};

module.exports = { isLoggedIn, isEmployer, isAdmin };