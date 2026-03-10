const expect = require('chai').expect;
const request = require('supertest');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');

// Mock the models and middleware
const app = express();
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', 'views');

app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: true,
}));

app.use(flash());

// Mock user session
let mockUser = null;

app.use((req, res, next) => {
    res.locals.user = mockUser;
    res.locals.isLanding = req.path === '/';
    res.locals.title = 'Job Portal';
    res.locals.success_msg = req.flash('success');
    res.locals.error_msg = req.flash('error');
    next();
});

// Load the routes
const landingRouter = express.Router();
landingRouter.get('/', (req, res) => {
    res.render('landing');
});
app.use('/', landingRouter);

const authRoutes = require('../routes/authRoutes');
app.use('/auth', authRoutes);


describe('Landing Page', () => {
    it('should always show Login and Register buttons', (done) => {
        request(app)
            .get('/')
            .end((err, res) => {
                expect(res.text).to.include('Login');
                expect(res.text).to.include('Register');
                done();
            });
    });

    it('should still show Login and Register buttons when a user is logged in', (done) => {
        mockUser = { name: 'Test User' }; // Simulate a logged-in user
        request(app)
            .get('/')
            .end((err, res) => {
                expect(res.text).to.include('Login');
                expect(res.text).to.include('Register');
                mockUser = null; // Reset mock user
                done();
            });
    });
});

describe('Authentication', () => {
    it('should redirect to the landing page on logout', (done) => {
        request(app)
            .get('/auth/logout')
            .expect(302) // Expect a redirect
            .end((err, res) => {
                expect(res.header.location).to.equal('/');
                done();
            });
    });
});
