const express = require('express');
const router = express.Router();
const Job = require('../models/job'); // Import the Job model
const Application = require('../models/application'); // Import the Application model
const User = require('../models/user');
const Message = require('../models/message');
const { isLoggedIn, isEmployer } = require('../models/authMiddleware');

// --- Fix: Ensure User Schema has isSubscribed field ---
if (User.schema && !User.schema.path('isSubscribed')) {
    User.schema.add({ isSubscribed: { type: Boolean, default: false } });
}

// --- Fix: Ensure Application Schema has resume and coverLetter fields ---
if (Application.schema) {
    if (!Application.schema.path('resume')) {
        Application.schema.add({ resume: String });
    }
    if (!Application.schema.path('coverLetter')) {
        Application.schema.add({ coverLetter: String });
    }
    // Fix: Add 'Accepted' to status enum if it exists
    const statusPath = Application.schema.path('status');
    if (statusPath && statusPath.enumValues && !statusPath.enumValues.includes('Accepted')) {
        statusPath.enumValues.push('Accepted');
    }
}

// --- Fix: Ensure Message Schema has isRead field ---
if (Message.schema && !Message.schema.path('isRead')) {
    Message.schema.add({ isRead: { type: Boolean, default: false } });
}

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// --- Multer Configuration for Resume Uploads ---
const uploadDir = path.join(__dirname, '../public/uploads/resumes');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    fileFilter: function (req, file, cb) {
        const filetypes = /pdf|doc|docx/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Error: Resumes only (PDF, DOC, DOCX)!'));
    }
});

const uploadResume = (req, res, next) => {
    upload.single('resume')(req, res, (err) => {
        if (err) {
            req.flash('error', err.message);
            return res.redirect(`/jobs/${req.params.id}`);
        }
        next();
    });
};

// @route   GET /jobs
// @desc    Display all jobs (the new "homepage" for logged-in users)
// @access  Public
router.get('/', async (req, res) => {
    try {
        const searchTerm = req.query.search || '';
        const searchFilter = searchTerm 
            ? { $text: { $search: searchTerm } } 
            : {};

        const jobs = await Job.find({ status: 'approved', ...searchFilter })
            .sort({ createdAt: -1 })
            .populate('employer', 'name');
        
        res.render('home', { jobs, searchTerm });
    } catch (error) {
        console.error('Error fetching jobs:', error);
        res.status(500).send('Server Error');
    }
});

// @route   GET /jobs/dashboard
// @desc    Display employer's dashboard with their jobs
// @access  Private (Employers only)
router.get('/dashboard', [isLoggedIn, isEmployer()], async (req, res) => {
    try {
        // 1. Find all jobs for the current employer
        const jobs = await Job.find({ employer: req.session.user.id }).sort({ createdAt: -1 }).lean();

        // 2. For each job, get the count of applications
        const jobsWithApplicantCounts = await Promise.all(jobs.map(async (job) => {
            const applicantCount = await Application.countDocuments({ job: job._id });
            return {
                ...job,
                applicantCount
            };
        }));

        // 3. Fetch sent messages
        const messages = await Message.find({ sender: req.session.user.id })
            .populate('recipient', 'name email')
            .sort({ createdAt: -1 })
            .lean();

        // 4. Count unread received messages
        const unreadMessageCount = await Message.countDocuments({
            recipient: req.session.user.id,
            isRead: false
        });

        // The view `employer-dashboard.ejs` is not in context, but you will need to update it.
        // In your `employer-dashboard.ejs` file, you can now access `job.applicantCount`
        // and add a link like:
        // <a href="/jobs/<%= job._id %>/applicants">View Applicants (<%= job.applicantCount %>)</a>

        res.render('employer-dashboard', { jobs: jobsWithApplicantCounts, messages, unreadMessageCount });
    } catch (error) {
        console.error('Error fetching employer jobs:', error);
        res.status(500).send('Server Error');
    }
});

// @route   GET /jobs/subscription
// @desc    Show subscription page with benefits and payment form
// @access  Private (Employers only)
router.get('/subscription', [isLoggedIn, isEmployer()], async (req, res) => {
    try {
        if (req.session.user.isSubscribed) {
            req.flash('info', 'You are already subscribed.');
            return res.redirect('/jobs/create');
        }

        const user = await User.findById(req.session.user.id);
        if (user && user.isSubscribed) {
            req.session.user.isSubscribed = true;
            req.flash('info', 'You are already subscribed.');
            return res.redirect('/jobs/create');
        }
    } catch (error) {
        console.error(error);
    }
    res.render('subscription', {
        benefits: [
            'Unlimited Job Postings',
            'Access to Candidate Resumes',
            'Priority Support',
            'Featured Listings'
        ],
        paymentDetails: 'One-time Subscription Cost: 399'
    });
});

// @route   POST /jobs/subscription
// @desc    Process subscription payment
// @access  Private (Employers only)
router.post('/subscription', [isLoggedIn, isEmployer()], async (req, res) => {
    
    try {
        // In a real app, verify payment with Stripe/PayPal here.
        
        // Update user to be subscribed permanently
        await User.findByIdAndUpdate(req.session.user.id, { $set: { isSubscribed: true } });
        req.session.user.isSubscribed = true;
        req.flash('success', 'Subscription active! You can now post jobs.');
        
        req.session.save((err) => {
            if (err) console.error('Session save error:', err);
            res.redirect('/jobs/create');
        });
    } catch (error) {
        console.error('Subscription error:', error);
        req.flash('error', 'An error occurred while processing subscription.');
        res.redirect('/jobs/subscription');
    }
});

// @route   GET /jobs/create
// @desc    Show the form to create a new job
// @access  Private (Employers only)
router.get('/create', [isLoggedIn, isEmployer()], async (req, res) => {
    try {
        if (req.session.user.isSubscribed) {
            return res.render('create-job');
        }

        const user = await User.findById(req.session.user.id);
        if (user && user.isSubscribed) {
            req.session.user.isSubscribed = true;
        } else {
            req.flash('error', 'You must have a one-time subscription to post jobs.');
            return res.redirect('/jobs/subscription');
        }
        res.render('create-job');
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
});

// @route   POST /jobs
// @desc    Create a new job
// @access  Private (Employers only)
router.post('/', [isLoggedIn, isEmployer()], async (req, res) => {
    try {
        if (!req.session.user.isSubscribed) {
            const user = await User.findById(req.session.user.id);
            if (user && user.isSubscribed) {
                req.session.user.isSubscribed = true;
            } else {
                req.flash('error', 'One-time subscription required to post jobs.');
                return res.redirect('/jobs/subscription');
            }
        }

        const { title, location, jobType, description, salary } = req.body;

        const newJob = new Job({
            title,
            location,
            jobType,
            description,
            salary,
            employer: req.session.user.id // Associate job with logged-in employer
            // The job 'status' will default to 'pending' as per the Job model schema
        });

        await newJob.save();
        res.render('job-submitted');
    } catch (error) {
        console.error('Error creating job:', error);
        res.status(500).send('Server Error');
    }
});

// @route   POST /jobs/:id/apply
// @desc    Handle a job application
// @access  Private (Job Seekers only)
router.post('/:id/apply', [isLoggedIn, uploadResume], async (req, res) => {
    try {
        // Ensure only job seekers can apply
        if (req.session.user.role !== 'job_seeker') {
            req.flash('error', 'Only job seekers can apply for jobs.');
            return res.redirect(`/jobs/${req.params.id}`);
        }

        if (!req.file) {
            req.flash('error', 'Please upload a resume.');
            return res.redirect(`/jobs/${req.params.id}`);
        }

        const { coverLetter } = req.body;
        
        console.log('Processing application. Resume:', req.file.filename);

        const newApplication = new Application({
            job: req.params.id,
            applicant: req.session.user.id,
        });

        // Explicitly set fields with strict: false to ensure they are saved
        // even if the schema update hasn't fully propagated to the compiled model
        newApplication.set('resume', `/uploads/resumes/${req.file.filename}`, { strict: false });
        newApplication.set('coverLetter', coverLetter, { strict: false });

        await newApplication.save();

        // Notify the employer about the new application
        const job = await Job.findById(req.params.id);
        if (job) {
            const newMessage = new Message({
                sender: req.session.user.id,
                recipient: job.employer,
                application: newApplication._id,
                subject: `New Application: ${job.title}`,
                body: `You have received a new application from ${req.session.user.name} for the position of ${job.title}. Please check your dashboard to review the application.`
            });
            await newMessage.save();
        }

        req.flash('success', 'Your application has been submitted successfully!');
        res.redirect(`/jobs/${req.params.id}`);

    } catch (error) {
        if (error.code === 11000) { // Handle duplicate application error from the unique index
            req.flash('error', 'You have already applied for this job.');
        } else {
            console.error('Error submitting application:', error);
            req.flash('error', 'An error occurred while submitting your application.');
        }
        res.redirect(`/jobs/${req.params.id}`);
    }
});

// @route   GET /jobs/:id/applicants
// @desc    View all applicants for a specific job
// @access  Private (Job owner only)
router.get('/:id/applicants', [isLoggedIn, isEmployer(true)], async (req, res) => {
    try {
        const jobId = req.params.id;
        const job = await Job.findById(jobId);

        // Security check: Ensure the current user owns this job
        if (!job || job.employer.toString() !== req.session.user.id) {
            req.flash('error', 'You are not authorized to view applicants for this job.');
            return res.redirect('/jobs/dashboard');
        }

        // Find all applications for this job and populate the applicant's details
        const applications = await Application.find({ job: jobId })
            .populate('applicant', 'name email createdAt') // Fetch applicant's name, email, and registration date
            .sort({ createdAt: -1 })
            .lean();

        res.render('job-applicants', { job, applications });

    } catch (error) {
        console.error('Error fetching applicants:', error);
        req.flash('error', 'An error occurred while fetching applicants.');
        res.redirect('/jobs/dashboard');
    }
});

// @route   POST /jobs/applications/:applicationId/status
// @desc    Update the status of a job application
// @access  Private (Job owner only)
router.post('/applications/:applicationId/status', [isLoggedIn, isEmployer(true)], async (req, res) => {
    const { applicationId } = req.params;
    const { status } = req.body;

    try {
        const application = await Application.findById(applicationId).populate('job').populate('applicant');

        if (!application) {
            req.flash('error', 'Application not found.');
            return res.redirect('/jobs/dashboard');
        }

        // Security check: Ensure the current user owns the job associated with the application
        if (application.job.employer.toString() !== req.session.user.id) {
            req.flash('error', 'You are not authorized to update this application.');
            return res.redirect('/jobs/dashboard');
        }

        application.status = status;
        // Bypass validation to allow 'Accepted' status if it's missing from the model enum
        await application.save({ validateBeforeSave: false });

        if (application.applicant) {
            let subject = `Application Status Update: ${application.job.title}`;
            let body = `The status of your application for ${application.job.title} has been updated to: ${status}.`;

            if (status === 'Accepted') {
                subject = `Application Accepted: ${application.job.title}`;
                body = `Congratulations! Your application for the position of ${application.job.title} has been accepted. We will contact you shortly via email or phone regarding the next steps.`;
            } else if (status === 'Rejected') {
                subject = `Application Update: ${application.job.title}`;
                body = `Thank you for your interest in the ${application.job.title} position. After careful consideration, we have decided not to move forward with your application at this time.`;
            }

            const newMessage = new Message({
                sender: req.session.user.id,
                recipient: application.applicant._id,
                application: application._id,
                subject: subject,
                body: body
            });
            await newMessage.save();
            console.log(`[SIMULATION] Auto-message sent to ${application.applicant.email} regarding status: ${status}.`);
        }

        req.flash('success', 'Application status has been updated.');
        res.redirect(`/jobs/${application.job._id}/applicants`);

    } catch (error) {
        console.error('Error updating application status:', error);
        req.flash('error', 'Failed to update application status.');
        res.redirect('back');
    }
});

// @route   GET /jobs/:id/admin
// @desc    Display job details specifically for admins
// @access  Private (Admin only)
router.get('/:id/admin', isLoggedIn, async (req, res) => {
    try {
        if (req.session.user.role !== 'admin') {
            req.flash('error', 'Access denied. Admins only.');
            return res.redirect('/jobs');
        }

        const job = await Job.findById(req.params.id).populate('employer', 'name email');
        if (!job) {
            return res.status(404).send('Job not found');
        }
        res.render('admin-job-detail', { job });
    } catch (error) {
        console.error('Error fetching job details for admin:', error);
        res.status(500).send('Server Error');
    }
});

// @route   GET /jobs/:id
// @desc    Display a single job's details
// @access  Public
router.get('/:id', async (req, res) => {
    try {
        let hasApplied = false;
        let applicationStatus = null;
        // If a job seeker is logged in, check if they have already applied
        if (req.session.user && req.session.user.role === 'job_seeker') {
            const existingApplication = await Application.findOne({
                job: req.params.id,
                applicant: req.session.user.id
            });
            if (existingApplication) {
                hasApplied = true;
                applicationStatus = existingApplication.status;
            }
        }

        const job = await Job.findById(req.params.id).populate('employer', 'name email');
        if (!job) {
            return res.status(404).send('Job not found');
        }
        res.render('job-detail', { job: job, hasApplied: hasApplied, applicationStatus: applicationStatus });
    } catch (error) {
        console.error('Error fetching job details:', error);
        res.status(500).send('Server Error or Invalid Job ID');
    }
});

// @route   GET /jobs/:id/edit
// @desc    Show the form to edit a job
// @access  Private (Job owner only)
router.get('/:id/edit', [isLoggedIn, isEmployer(true)], async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);
        if (!job || job.employer.toString() !== req.session.user.id) {
            return res.status(403).send('Forbidden: You do not own this job posting.');
        }
        res.render('edit-job', { job: job });
    } catch (error) {
        console.error('Error fetching job for edit:', error);
        res.status(500).send('Server Error');
    }
});

// @route   POST /jobs/:id/edit
// @desc    Update a job posting
// @access  Private (Job owner only)
router.post('/:id/edit', [isLoggedIn, isEmployer(true)], async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);
        if (!job || job.employer.toString() !== req.session.user.id) {
            return res.status(403).send('Forbidden: You do not own this job posting.');
        }
        // Explicitly define updatable fields for security
        const { title, location, jobType, description, salary } = req.body;
        await Job.findByIdAndUpdate(req.params.id, {
            title,
            location,
            jobType,
            description,
            salary
        });
        res.redirect('/jobs/dashboard');
    } catch (error) {
        console.error('Error updating job:', error);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /jobs/:id
// @desc    Delete a job posting
// @access  Private (Job owner only)
router.delete('/:id', [isLoggedIn, isEmployer(true)], async (req, res) => {
    try {
        const job = await Job.findOneAndDelete({ _id: req.params.id, employer: req.session.user.id });
        if (job) {
            await Application.deleteMany({ job: job._id });
        }
        res.redirect('/jobs/dashboard');
    } catch (error) {
        console.error('Error deleting job:', error);
        res.status(500).send('Server Error');
    }
});

module.exports = router;