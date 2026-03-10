const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Job = require('../models/job');
const Application = require('../models/application');
const Message = require('../models/message');
const { isLoggedIn, isAdmin } = require('../models/authMiddleware');

// --- Fix: Ensure Schemas have banReason field ---
if (User.schema && !User.schema.path('banReason')) {
    User.schema.add({ banReason: String });
}
if (Job.schema && !Job.schema.path('banReason')) {
    Job.schema.add({ banReason: String });
}

// @route   GET /admin/dashboard
// @desc    Display admin dashboard with pending employers
// @access  Private (Admin only)
router.get('/dashboard', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        // --- Pagination & Tab Logic ---
        const searchTerm = req.query.search || '';
        const activeTab = req.query.tab || 'pending-employers'; // Default to the first tab
        const page = parseInt(req.query.page, 10) || 1;
        const limit = 10; // Number of items per page
        const skip = (page - 1) * limit;

        res.locals.title = 'Admin Dashboard';

        // --- Database Queries ---
        // 1. Fetch all counts in parallel
        const [
            userStats,
            jobStats,
            employerStatusStats
        ] = await Promise.all([
            User.aggregate([ { $group: { _id: '$role', count: { $sum: 1 } } } ]),
            Job.aggregate([ { $group: { _id: '$status', count: { $sum: 1 } } } ]),
            User.aggregate([ { $match: { role: 'employer' } }, { $group: { _id: '$verificationStatus', count: { $sum: 1 } } } ])
        ]);

        // Process counts into a usable object
        const userCounts = userStats.reduce((acc, { _id, count }) => ({ ...acc, [_id]: count }), {});
        const jobCounts = jobStats.reduce((acc, { _id, count }) => ({ ...acc, [_id]: count }), {});
        const employerCounts = employerStatusStats.reduce((acc, { _id, count }) => ({ ...acc, [_id]: count }), {});

        const stats = {
            totalUsers: userStats.reduce((sum, item) => sum + item.count, 0),
            totalJobs: jobStats.reduce((sum, item) => sum + item.count, 0),
            // Use the more specific employer counts
            pendingEmployers: employerCounts.pending || 0,
            approvedEmployers: employerCounts.verified || 0,
            rejectedEmployers: employerCounts.rejected || 0,
            pendingJobs: jobCounts.pending || 0,
        };

        // --- Search Logic ---
        const searchFilter = searchTerm 
            ? { $text: { $search: searchTerm } } 
            : {};

        // 2. Define all possible data queries
        const queries = {
            'pending-employers': User.find({ role: 'employer', verificationStatus: 'pending', ...searchFilter }),
            'approved-employers': User.find({ role: 'employer', verificationStatus: 'verified', ...searchFilter }),
            'rejected-employers': User.find({ role: 'employer', verificationStatus: 'rejected', ...searchFilter }),
            'pending-jobs': Job.find({ status: 'pending', ...searchFilter }).populate('employer', 'name _id'),
            'all-employers': User.find({ role: 'employer', ...searchFilter }),
            'all-jobseekers': User.find({ role: 'job_seeker', ...searchFilter }),
            'all-jobs': Job.find({ ...searchFilter }).populate('employer', 'name _id')
        };

        // Get counts for the *filtered* results for accurate pagination
        const [
            pendingEmployerCount,
            approvedEmployerCount,
            rejectedEmployerCount,
            pendingJobCount,
            allEmployerCount,
            allJobSeekerCount,
            allJobCount
        ] = await Promise.all([
            User.countDocuments({ role: 'employer', verificationStatus: 'pending', ...searchFilter }),
            User.countDocuments({ role: 'employer', verificationStatus: 'verified', ...searchFilter }),
            User.countDocuments({ role: 'employer', verificationStatus: 'rejected', ...searchFilter }),
            Job.countDocuments({ status: 'pending', ...searchFilter }),
            User.countDocuments({ role: 'employer', ...searchFilter }),
            User.countDocuments({ role: 'job_seeker', ...searchFilter }),
            Job.countDocuments({ ...searchFilter })
        ]);

        // Update stats with filtered counts for the badges
        // Note: The main stat cards will show total pending, but the badges on tabs will show filtered counts.
        stats.pendingEmployers = pendingEmployerCount;
        stats.approvedEmployers = approvedEmployerCount;
        stats.rejectedEmployers = rejectedEmployerCount;
        stats.pendingJobs = pendingJobCount;
        stats.allEmployers = allEmployerCount;
        stats.allJobSeekers = allJobSeekerCount;
        stats.allJobs = allJobCount;

        // 3. Fetch data for each list. The active tab gets paginated, others get a small preview.
        const dataPromises = Object.entries(queries).map(([key, query]) => {
            if (key === activeTab) {
                return query.sort({ createdAt: -1 }).skip(skip).limit(limit).exec(); // Apply pagination
            }
            return query.sort({ createdAt: -1 }).limit(5).exec(); // Get a preview
        });

        const [pendingEmployers, approvedEmployers, rejectedEmployers, pendingJobs, allEmployers, allJobSeekers, allJobs] = await Promise.all(dataPromises);

        // --- Calculate Total Pages for the Active Tab ---
        let totalPages = 0;
        if (activeTab === 'pending-employers') totalPages = Math.ceil(stats.pendingEmployers / limit);
        if (activeTab === 'approved-employers') totalPages = Math.ceil(stats.approvedEmployers / limit);
        if (activeTab === 'rejected-employers') totalPages = Math.ceil(stats.rejectedEmployers / limit);
        if (activeTab === 'pending-jobs') totalPages = Math.ceil(stats.pendingJobs / limit);
        if (activeTab === 'all-employers') totalPages = Math.ceil(stats.allEmployers / limit);
        if (activeTab === 'all-jobseekers') totalPages = Math.ceil(stats.allJobSeekers / limit);
        if (activeTab === 'all-jobs') totalPages = Math.ceil(stats.allJobs / limit);

        // Render the dashboard with all the fetched and processed data.
        // The `user` and flash messages are available globally via `res.locals` from server.js.
        res.render('admin-dashboard', {
            stats,
            pendingEmployers,
            approvedEmployers,
            rejectedEmployers,
            pendingJobs,
            allEmployers,
            allJobSeekers,
            allJobs,
            activeTab,
            searchTerm,
            currentPage: page,
            totalPages: totalPages > 0 ? totalPages : 1
        });
    } catch (error) {
        console.error('Error fetching admin dashboard data:', error);
        res.status(500).send('Server Error');
    }
});

// @route   GET /admin/users/:id
// @desc    Display details for a single user
// @access  Private (Admin only)
router.get('/users/:id', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            req.flash('error', 'User not found.');
            return res.redirect('/admin/dashboard');
        }

        let jobs = [];
        if (user.role === 'employer') {
            jobs = await Job.find({ employer: user._id }).sort({ createdAt: -1 });
        }

        res.locals.title = `Details for ${user.name}`;
        res.render('admin-user-detail', { userDetails: user, jobs });

    } catch (error) {
        console.error('Error fetching user details:', error);
        req.flash('error', 'Server error while fetching user details.');
        res.redirect('/admin/dashboard');
    }
});

// @route   GET /admin/analytics
// @desc    Display analytics page with charts
// @access  Private (Admin only)
router.get('/analytics', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        res.locals.title = 'Dashboard Analytics';

        const [userStats, jobStats] = await Promise.all([
            User.aggregate([ { $group: { _id: '$role', count: { $sum: 1 } } } ]),
            Job.aggregate([ { $group: { _id: '$status', count: { $sum: 1 } } } ])
        ]);

        const jobCounts = jobStats.reduce((acc, { _id, count }) => ({ ...acc, [_id]: count }), {});

        // --- Prepare Data for Charts ---
        const chartData = {
            userRoles: {
                labels: userStats.map(item => (item._id || 'Undefined').replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())),
                data: userStats.map(item => item.count)
            },
            jobStatuses: {
                labels: ['Approved', 'Pending', 'Rejected'],
                data: [
                    jobCounts.approved || 0,
                    jobCounts.pending || 0,
                    jobCounts.rejected || 0
                ]
            }
        };

        res.render('admin-analytics', {
            chartData
        });

    } catch (error) {
        console.error('Error fetching analytics data:', error);
        res.status(500).send('Server Error');
    }
});

// @route   POST /admin/employers/:id/approve
// @desc    Approve an employer
// @access  Private (Admin only)
router.post('/employers/:id/approve', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(req.params.id, { verificationStatus: 'verified' });
        if (!user) {
            req.flash('error', 'Employer not found.');
        } else {
            req.flash('success', 'Employer has been approved.');
        }
    } catch (error) {
        console.error('Error approving employer:', error);
        req.flash('error', 'Failed to approve employer.');
    }
    res.redirect('/admin/dashboard?tab=pending-employers');
});

// @route   POST /admin/employers/:id/reject
// @desc    Reject an employer
// @access  Private (Admin only)
router.post('/employers/:id/reject', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        // We mark them as 'rejected' to preserve their data and prevent re-registration.
        const user = await User.findByIdAndUpdate(req.params.id, { verificationStatus: 'rejected' });
        if (!user) {
            req.flash('error', 'Employer not found.');
        } else {
            req.flash('success', 'Employer has been rejected.');
        }
    } catch (error) {
        console.error('Error rejecting employer:', error);
        req.flash('error', 'Failed to reject employer.');
    }
    res.redirect('/admin/dashboard?tab=pending-employers');
});

// @route   POST /admin/jobs/:id/approve
// @desc    Approve a job
// @access  Private (Admin only)
router.post('/jobs/:id/approve', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        const job = await Job.findByIdAndUpdate(req.params.id, { status: 'approved' });
        if (!job) {
            req.flash('error', 'Job not found.');
        } else {
            req.flash('success', 'Job has been approved and is now live.');
        }
    } catch (error) {
        console.error('Error approving job:', error);
        req.flash('error', 'Failed to approve job.');
    }
    res.redirect('/admin/dashboard?tab=pending-jobs');
});

router.post('/jobs/:id/reject', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        const job = await Job.findByIdAndUpdate(req.params.id, { status: 'rejected' });
        if (!job) {
            req.flash('error', 'Job not found.');
        } else {
            req.flash('success', 'Job has been rejected.');
        }
    } catch (error) {
        console.error('Error rejecting job:', error);
        req.flash('error', 'Failed to reject job.');
    }
    res.redirect('/admin/dashboard?tab=pending-jobs');
});

// @route   POST /admin/users/:id/freeze
// @desc    Freeze (suspend) a user's account
// @access  Private (Admin only)
router.post('/users/:id/freeze', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(req.params.id, { verificationStatus: 'frozen' });
        if (!user) {
            req.flash('error', 'User not found.');
        } else {
            req.flash('success', `User "${user.name}" has been frozen.`);
        }
    } catch (error) {
        console.error('Error freezing user:', error);
        req.flash('error', 'Failed to freeze user.');
    }
    res.redirect('back'); // Redirect to the previous page
});

// @route   POST /admin/users/:id/unfreeze
// @desc    Unfreeze a user's account (sets it back to 'verified')
// @access  Private (Admin only)
router.post('/users/:id/unfreeze', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(req.params.id, { verificationStatus: 'verified' });
        if (!user) {
            req.flash('error', 'User not found.');
        } else {
            req.flash('success', `User "${user.name}" has been unfrozen.`);
        }
    } catch (error) {
        console.error('Error unfreezing user:', error);
        req.flash('error', 'Failed to unfreeze user.');
    }
    res.redirect('back'); // Redirect to the previous page
});

// @route   POST /admin/users/:id/ban
// @desc    Ban a user
// @access  Private (Admin only)
router.post('/users/:id/ban', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        const { banReason } = req.body;
        const user = await User.findByIdAndUpdate(req.params.id, {
            verificationStatus: 'banned',
            banReason: banReason
        });
        
        if (!user) {
            req.flash('error', 'User not found.');
        } else {
            req.flash('success', `User "${user.name}" has been banned.`);
        }
    } catch (error) {
        console.error('Error banning user:', error);
        req.flash('error', 'Failed to ban user.');
    }
    res.redirect('back');
});

// @route   DELETE /admin/users/:id
// @desc    Delete a user permanently
// @access  Private (Admin only)
router.delete('/users/:id', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (user) {
            // 1. Delete the user
            await User.findByIdAndDelete(req.params.id);

            // 2. If user is an employer, delete their jobs and associated applications
            if (user.role === 'employer') {
                const jobs = await Job.find({ employer: user._id });
                for (const job of jobs) {
                    await Application.deleteMany({ job: job._id });
                    await Job.findByIdAndDelete(job._id);
                }
            }

            // 3. Delete any applications made by this user (if they were a job seeker)
            await Application.deleteMany({ applicant: user._id });
            
            // 4. Delete messages
            await Message.deleteMany({ $or: [{ sender: user._id }, { recipient: user._id }] });
        }

        req.flash('success', 'User has been permanently deleted.');
    } catch (error) {
        console.error('Error deleting user:', error);
        req.flash('error', 'Failed to delete user.');
    }
    res.redirect('back');
});

// @route   POST /admin/jobs/:id/ban
// @desc    Ban a job
// @access  Private (Admin only)
router.post('/jobs/:id/ban', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        const { banReason } = req.body;
        const job = await Job.findByIdAndUpdate(req.params.id, {
            status: 'banned',
            banReason: banReason
        });

        if (job) {
            // Notify the employer via internal message
            const newMessage = new Message({
                sender: req.session.user.id,
                recipient: job.employer,
                subject: `Job Posting Banned: ${job.title}`,
                body: `Your job posting "${job.title}" has been banned by the administrator.\n\nReason: ${banReason || 'Violation of terms'}`
            });
            await newMessage.save();
        }
        req.flash('success', 'Job has been banned.');
    } catch (error) {
        console.error('Error banning job:', error);
        req.flash('error', 'Failed to ban job.');
    }
    res.redirect('back');
});

// @route   DELETE /admin/jobs/:id
// @desc    Delete a job permanently
// @access  Private (Admin only)
router.delete('/jobs/:id', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        const job = await Job.findByIdAndDelete(req.params.id);
        if (job) {
            await Application.deleteMany({ job: job._id });
        }
        req.flash('success', 'Job has been permanently deleted.');
    } catch (error) {
        console.error('Error deleting job:', error);
        req.flash('error', 'Failed to delete job.');
    }
    res.redirect('back');
});

// @route   POST /admin/clear-data
// @desc    Delete all users, jobs, applications (Reset DB)
// @access  Private (Admin only)
router.post('/clear-data', [isLoggedIn, isAdmin], async (req, res) => {
    try {
        // 1. Delete all Jobs
        await Job.deleteMany({});
        
        // 2. Delete all Applications
        await Application.deleteMany({});

        // 3. Delete all Messages
        await Message.deleteMany({});

        // 4. Delete all Users EXCEPT the current logged-in admin
        await User.deleteMany({ _id: { $ne: req.session.user.id } });

        req.flash('success', 'System data reset successfully. All users (except you), jobs, and applications have been deleted.');
    } catch (error) {
        console.error('Error clearing data:', error);
        req.flash('error', 'Failed to reset system data.');
    }
    res.redirect('/admin/dashboard');
});

module.exports = router;