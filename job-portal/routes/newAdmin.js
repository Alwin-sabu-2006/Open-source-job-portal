const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Job = require('../models/job');
const Application = require('../models/application');
const { isLoggedIn, isAdmin } = require('../models/authMiddleware');

// @route   GET /admin/
// @desc    Redirect to the admin dashboard
// @access  Private (Admin only)
router.get('/', [isLoggedIn, isAdmin], (req, res) => {
    res.redirect('/admin/dashboard');
});

// @route   GET /admin/dashboard
// @desc    Display new admin dashboard
// @access  Private (Admin only)
router.get('/dashboard', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        res.locals.title = 'Admin Dashboard';

        const [
            userCount,
            jobCount,
            pendingEmployers,
            pendingJobs
        ] = await Promise.all([
            User.countDocuments(),
            Job.countDocuments(),
            User.find({ role: 'employer', verificationStatus: 'pending' }),
            Job.find({ status: 'pending' }).populate('employer', 'name')
        ]);

        res.render('admin-new', {
            userCount,
            jobCount,
            pendingEmployers,
            pendingJobs
        });
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        res.status(500).send('Server Error');
    }
});

// --- API Routes for DataTables ---

// @route   GET /admin/api/users
// @desc    Get users for DataTables
// @access  Private (Admin only)
router.get('/api/users', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        const users = await User.find({});
        const data = users.map(user => ({
            name: user.name,
            email: user.email,
            role: user.role,
            verificationStatus: user.verificationStatus,
            actions: 
                `<form action="/admin/api/users/approve/${user._id}" method="POST" class="d-inline">` +
                    `<button type="submit" class="btn btn-sm btn-success">Approve</button>` +
                `</form> ` +
                `<form action="/admin/api/users/reject/${user._id}" method="POST" class="d-inline">` +
                    `<button type="submit" class="btn btn-sm btn-warning">Reject</button>` +
                `</form> ` +
                `<form action="/admin/api/users/delete/${user._id}" method="POST" class="d-inline" onsubmit="return confirm('Are you sure?');">` +
                    `<button type="submit" class="btn btn-sm btn-danger">Delete</button>` +
                `</form>`
        }));
        res.json({
            recordsTotal: users.length,
            recordsFiltered: users.length,
            data
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// @route   GET /admin/api/jobs
// @desc    Get jobs for DataTables
// @access  Private (Admin only)
router.get('/api/jobs', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        const jobs = await Job.find({}).populate('employer', 'name');
        const data = jobs.map(job => ({
            title: job.title,
            'employer.name': job.employer ? job.employer.name : 'N/A',
            status: job.status,
            createdAt: job.createdAt.toDateString(),
            actions: 
                `<form action="/admin/api/jobs/approve/${job._id}" method="POST" class="d-inline">` +
                    `<button type="submit" class="btn btn-sm btn-success">Approve</button>` +
                `</form> ` +
                `<form action="/admin/api/jobs/reject/${job._id}" method="POST" class="d-inline">` +
                    `<button type="submit" class="btn btn-sm btn-warning">Reject</button>` +
                `</form> ` +
                `<form action="/admin/api/jobs/delete/${job._id}" method="POST" class="d-inline" onsubmit="return confirm('Are you sure?');">` +
                    `<button type="submit" class="btn btn-sm btn-danger">Delete</button>` +
                `</form>`
        }));
        res.json({
            recordsTotal: jobs.length,
            recordsFiltered: jobs.length,
            data
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// --- API Routes for Actions ---

// @route   POST /admin/api/users/approve/:id
// @desc    Approve an employer
// @access  Private (Admin only)
router.post('/api/users/approve/:id', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.params.id, { verificationStatus: 'verified' });
        req.flash('success', 'Employer approved.');
        res.redirect('/admin/dashboard');
    } catch (error) {
        req.flash('error', 'Failed to approve employer.');
        res.redirect('/admin/dashboard');
    }
});

// @route   POST /admin/api/users/reject/:id
// @desc    Reject an employer
// @access  Private (Admin only)
router.post('/api/users/reject/:id', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.params.id, { verificationStatus: 'rejected' });
        req.flash('success', 'Employer rejected.');
        res.redirect('/admin/dashboard');
    } catch (error) {
        req.flash('error', 'Failed to reject employer.');
        res.redirect('/admin/dashboard');
    }
});

// @route   POST /admin/api/users/delete/:id
// @desc    Delete a user
// @access  Private (Admin only)
router.post('/api/users/delete/:id', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        console.log('Attempting to delete user:', req.params.id);
        const userId = req.params.id;
        // Delete the user
        await User.findByIdAndDelete(userId);
        
        // Cleanup: Delete applications made by this user
        await Application.deleteMany({ applicant: userId });
        
        // Cleanup: If user was employer, delete their jobs and applications to those jobs
        const jobs = await Job.find({ employer: userId });
        for (const job of jobs) {
            await Application.deleteMany({ job: job._id });
            await Job.findByIdAndDelete(job._id);
        }

        req.flash('success', 'User and related data deleted.');
        res.redirect('/admin/dashboard');
    } catch (error) {
        console.error('Error deleting user:', error);
        req.flash('error', 'Failed to delete user.');
        res.redirect('/admin/dashboard');
    }
});


// @route   POST /admin/api/jobs/approve/:id
// @desc    Approve a job
// @access  Private (Admin only)
router.post('/api/jobs/approve/:id', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        await Job.findByIdAndUpdate(req.params.id, { status: 'approved' });
        req.flash('success', 'Job approved.');
        res.redirect('/admin/dashboard');
    } catch (error) {
        req.flash('error', 'Failed to approve job.');
        res.redirect('/admin/dashboard');
    }
});

// @route   POST /admin/api/jobs/reject/:id
// @desc    Reject a job
// @access  Private (Admin only)
router.post('/api/jobs/reject/:id', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        await Job.findByIdAndUpdate(req.params.id, { status: 'rejected' });
        req.flash('success', 'Job rejected.');
        res.redirect('/admin/dashboard');
    } catch (error) {
        req.flash('error', 'Failed to reject job.');
        res.redirect('/admin/dashboard');
    }
});

// @route   POST /admin/api/jobs/delete/:id
// @desc    Delete a job
// @access  Private (Admin only)
router.post('/api/jobs/delete/:id', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        console.log('Attempting to delete job:', req.params.id);
        const jobId = req.params.id;
        await Job.findByIdAndDelete(jobId);
        await Application.deleteMany({ job: jobId }); // Delete associated applications
        req.flash('success', 'Job deleted.');
        res.redirect('/admin/dashboard');
    } catch (error) {
        console.error('Error deleting job:', error);
        req.flash('error', 'Failed to delete job.');
        res.redirect('/admin/dashboard');
    }
});

module.exports = router;
