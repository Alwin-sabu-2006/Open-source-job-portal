const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
const User = require('./models/user');

const deleteAdmin = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB connected for admin deletion...');

        // Log the email being targeted for debugging
        console.log(`Attempting to delete admin with email: ${process.env.ADMIN_EMAIL || 'admin@careerio.com (default)'}`);

        const adminEmail = (process.env.ADMIN_EMAIL || 'admin@careerio.com').toLowerCase();

        const result = await User.deleteOne({ email: adminEmail });

        if (result.deletedCount > 0) {
            console.log(`Successfully deleted admin user with email: ${adminEmail}`);
        } else {
            console.log(`No admin user found with email: ${adminEmail}`);
        }
    } catch (error) {
        console.error('Error deleting admin user:', error);
    } finally {
        mongoose.disconnect();
        console.log('MongoDB disconnected.');
    }
};

deleteAdmin();