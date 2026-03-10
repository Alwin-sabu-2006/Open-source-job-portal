const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['job_seeker', 'employer', 'admin'],
        required: true
    },
    // Employer-specific fields
    companyName: {
        type: String,
        trim: true
    },
    companyWebsite: {
        type: String,
        trim: true
    },
    jobTitle: {
        type: String,
        trim: true
    },
    companyAddress: {
        type: String,
        trim: true
    },
    contactPhone: {
        type: String,
        trim: true
    },
    verificationDocument: {
        type: String,
        // We will store the path to the uploaded file
    },
    verificationStatus: {
        type: String,
        enum: ['pending', 'verified', 'rejected'],
        default: 'pending' // A simpler default, will be overridden on creation
    }
}, { timestamps: true });

// Create a text index for searching
userSchema.index({ name: 'text', email: 'text', companyName: 'text' });

// Hash password before saving the user model
userSchema.pre('save', async function(next) {
    // Only hash the password if it has been modified (or is new)
    if (!this.isModified('password')) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Method to compare password for login
userSchema.methods.comparePassword = function(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);