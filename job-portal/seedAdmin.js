const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
const User = require('./models/user');

const createAdmin = async () => {
    try {
        if (!process.env.MONGO_URI) {
            throw new Error('MONGO_URI must be set in your .env file.');
        }
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB connected for seeding...');

        // --- Hardcoded Admin Credentials ---
        const adminEmail = 'ceoconnectio2025@gmail.com';
        const adminPassword = 'Alwin@2006';
        console.log(`Ensuring admin account exists for: ${adminEmail}`);

        // --- Reset Logic: Delete existing admin to ensure a clean slate ---
        const deleteResult = await User.deleteOne({ email: adminEmail.toLowerCase() });
        if (deleteResult.deletedCount > 0) {
            console.log(`Removed previous admin user: ${adminEmail}`);
        } else {
            console.log('No previous admin account found to remove.');
        }

        // --- Creation Logic ---
        const admin = new User({
            name: 'Admin',
            email: adminEmail, // The model will lowercase this
            password: adminPassword, // The model will hash this
            role: 'admin', // The user's role
            verificationStatus: 'verified' // The user's status
        });

        await admin.save();
        console.log('CEO/Admin user created successfully!');

    } catch (error) {
        console.error('Error seeding admin user:', error);
    } finally {
        mongoose.disconnect();
        console.log('MongoDB disconnected.');
    }
};

createAdmin();