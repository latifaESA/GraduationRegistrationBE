// Server.js - Main Entry Point

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'graduation_registration',
    waitForConnections: true,
    connectionLimit: 10,
    timezone: "+00:00", // Set UTC timezone
    queueLimit: 0
});

app.get('/api/test', async (req, res) => {
    res.status(200).json({'name': 'Test'});
})

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Email Service Setup
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,         // smtp.office365.com
    port: process.env.EMAIL_PORT,         // 587
    secure: false,                        // false for STARTTLS
    auth: {
        user: process.env.EMAIL_USER,       // graduation.registration@esa.edu.lb
        pass: process.env.EMAIL_PASSWORD,   // Esa@2025
    },
    tls: {
        ciphers: 'SSLv3',
        rejectUnauthorized: false           // Helps with some certificate issues
    }
});

// Set fixed expiry date: June 23, 2025
const getTokenExpiryDate = () => {
    // Create a date for June 23, 2025
    const expiryDate = new Date(2025, 5, 23, 23, 59, 59); // Month is 0-based, so 5 = June
    return expiryDate;
};

// Authentication Middleware
const authenticate = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;

        next();
    } catch (error) {
        return res.status(401).json({ message: 'Invalid token' });
    }
};

// ===== GRADUATE REGISTRATION API ROUTES =====

// Level 1: Initial Graduate Registration
app.post('/api/registration/level1', async (req, res) => {
    const { firstName, lastName, email, promotion, isAttending } = req.body;

    if (!firstName || !lastName || !email || !promotion) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    try {
        // Check if email exists in the database
        const [rows] = await pool.execute(
            'SELECT * FROM graduates WHERE email = ?',
            [email]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                message: 'Your email is not registered. Please use the email address where you received the message from ESA.'
            });
        }

        // Create a unique token
        const token = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = getTokenExpiryDate(); // Set expiry to June 23, 2025

        // Update graduate information
        await pool.execute(
            `UPDATE graduates 
       SET first_name = ?, last_name = ?, promotion = ?, is_attending = ?, 
           registration_stage = 2, registration_token = ?, token_expiry = ?
       WHERE email = ?`,
            [firstName, lastName, promotion, isAttending ? 1 : 0, token, tokenExpiry, email]
        );

        // Send follow-up email with Level 2 link
        if (isAttending) {
            const registrationLink = `${process.env.FRONTEND_URL}/registration/level2/${token}`;
            console.log(`${registrationLink}`);

            await transporter.sendMail({
                from: process.env.EMAIL_FROM,
                to: email,
                subject: 'ESA Graduation Ceremony - Registration Confirmation',
                html: `
    <div style="font-family: Arial, sans-serif; color: #662d91; max-width: 800px; margin: 0 auto;">
        <p style="font-size: 16px;">Dear ${firstName},</p>
        
        <p style="font-size: 16px;">Thank you for registering to attend your graduation ceremony – we are excited to celebrate this milestone with you!</p>
        
        <p style="font-size: 16px;">Below, you will find the event details, as well as an important request regarding your guests:</p>
        
        <hr style="border: 0; height: 1px; background-color: #662d91; margin: 20px 0;">
        
        <p style="font-size: 18px; font-weight: bold;">
            <span style="display: inline-block; vertical-align: middle;">🎓</span> 
            Graduation Ceremony Details
        </p>
        
        <p style="font-size: 16px;"><strong>Date:</strong> September 19, 2025</p>
        
        <p style="font-size: 16px;"><strong>Time:</strong> 6:00 PM | Graduates are requested to arrive at 4:00 PM</p>
        
        <p style="font-size: 16px;"><strong>Venue:</strong> Résidence des Pins</p>
        
        <hr style="border: 0; height: 1px; background-color: #662d91; margin: 20px 0;">
        
        <p style="font-size: 16px;">To ensure smooth access on the day of the event, please click the link below and provide the full names and contact details of the guests who will be accompanying you.</p>
        
        <p style="font-size: 16px;">
            <span style="display: inline-block; vertical-align: middle;">🔗</span>
            <a href="${registrationLink}" style="color: #662d91;">${registrationLink}</a>
        </p>
        
        <p style="font-size: 16px;"><strong>Please note:</strong></p>
        
        <ul style="color: #662d91; font-size: 16px;">
            <li><strong>Each graduate is allowed two guest cards only.</strong></li>
            <li>Résidence des Pins has <strong>strict security policies</strong> – the names must match the guests' official IDs.</li>
            <li>No one will be admitted without proper ID matching the submitted names.</li>
        </ul>
        
        <p style="font-size: 16px;">To avoid any inconvenience, kindly complete this form <strong>by June 23, 2025.</strong></p>
        
        <p style="font-size: 16px;">Thank you for your cooperation, and we look forward to celebrating together!</p>
        
        <p style="font-size: 16px;">Best regards,<br>ESA team</p>
    </div>
    `,
            });
        }

        return res.status(200).json({
            message: isAttending ? 'Registration successful. Please check your email for the next step.' :
                'Thank you for informing us that you will not be attending.'
        });

    } catch (error) {
        console.error('Registration error:', error);
        return res.status(500).json({ message: 'An error occurred during registration' });
    }
});

// Level 2: Attendee Registration
app.post('/api/registration/level2/:token', async (req, res) => {
    const { token } = req.params;
    const { attendeeCount, attendees } = req.body;

    if (attendeeCount === undefined) {
        return res.status(400).json({ message: 'Attendee count is required' });
    }

    try {
        // Verify token and get graduate
        const [graduates] = await pool.execute(
            'SELECT id, first_name, last_name, email FROM graduates WHERE registration_token = ? AND token_expiry > NOW()',
            [token]
        );

        if (graduates.length === 0) {
            return res.status(404).json({ message: 'Invalid or expired registration link' });
        }

        const graduate = graduates[0];

        // Create a new token for level 3
        const newToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = getTokenExpiryDate(); // Set expiry to June 23, 2025

        // Delete any existing attendees
        await pool.execute('DELETE FROM attendees WHERE graduate_id = ?', [graduate.id]);

        // Insert new attendees if any
        if (attendeeCount > 0 && attendees && attendees.length > 0) {
            for (const attendee of attendees) {
                if (attendee.firstName && attendee.lastName && attendee.dateOfBirth) {
                    await pool.execute(
                        'INSERT INTO attendees (graduate_id, first_name, last_name, date_of_birth) VALUES (?, ?, ?, ?)',
                        [graduate.id, attendee.firstName, attendee.lastName, attendee.dateOfBirth]
                    );
                }
            }
        }

        // Update graduate registration stage
        await pool.execute(
            `UPDATE graduates
             SET registration_stage = 3, registration_token = ?, token_expiry = ?
             WHERE id = ?`,
            [newToken, tokenExpiry, graduate.id]
        );

        // Set up modification link
        const modificationLink = `${process.env.FRONTEND_URL}/registration/level3/${newToken}`;
        console.log(`${modificationLink}`);

        // Common styling for both email templates
        const commonEmailStyle = `
            body { 
                font-family: Arial, sans-serif; 
                color: #602060; 
                line-height: 1.5;
            }
            .divider {
                border-top: 1px solid #d0d0d0;
                margin: 20px 0;
            }
            h2 {
                color: #602060;
                margin-bottom: 5px;
            }
            ul {
                padding-left: 20px;
            }
            li {
                margin-bottom: 10px;
            }
        `;

        // Determine which email template to use based on attendee count
        let emailSubject = 'ESA Graduation Ceremony - Registration Information';
        let emailContent = '';

        if (attendeeCount === 0) {
            // Template for 0 attendees
            emailContent = `
            <div style="${commonEmailStyle}">
                <p>Dear ${graduate.first_name},</p>
                <p>Thank you for registering to attend your graduation ceremony – we are excited to celebrate this milestone with you!</p>
                <p>Below, you will find the event details, as well as an important request regarding your guests:</p>
                
                <div class="divider"></div>
                
                <h2>🎓 Graduation Ceremony Details</h2>
                <p><strong>Date:</strong> September 19, 2025</p>
                <p><strong>Time:</strong> 6:00 PM | Graduates are requested to arrive at 4:00 PM</p>
                <p><strong>Venue:</strong> Résidence des Pins</p>
                
                <div class="divider"></div>
                
                <p>We noticed that you initially registered with <strong>0 attendees</strong> for the upcoming graduation ceremony. To ensure smooth access on the day of the event, please click the link below and provide the full names and contact details of the guests who will be accompanying you.</p>
                
                <p><a href="${modificationLink}" style="color: #602060;">Register Your Guests</a></p>
                
                <p>Please note:</p>
                <ul>
                    <li>Each graduate is allowed two guest cards only.</li>
                    <li>Résidence des Pins has <strong>strict security policies</strong> – the names must match the guests' official IDs.</li>
                    <li>No one will be admitted without proper ID matching the submitted names.</li>
                </ul>
                
                <p>To avoid any inconvenience, kindly complete this form <strong>by June 23, 2025</strong>.</p>
                
                <p>Thank you for your cooperation, and we look forward to celebrating together!</p>
                
                <p>Best regards,<br>
                ESA team</p>
            </div>
            `;
        } else {
            // Template for 1-2 attendees
            let attendeeListItems = '';

            if (attendees && attendees.length > 0) {
                for (let i = 0; i < attendees.length; i++) {
                    attendeeListItems += `<p><strong>Guest ${i+1}:</strong> ${attendees[i].firstName} ${attendees[i].lastName}, Date of Birth: ${attendees[i].dateOfBirth}</p>`;
                }
            }

            emailContent = `
            <div style="${commonEmailStyle}">
                <p>Dear ${graduate.first_name},</p>
                <p>Thank you for registering to attend your graduation ceremony – we are excited to celebrate this milestone with you!</p>
                <p>Below, you will find the event details, as well as information about your registered guests:</p>
                
                <div class="divider"></div>
                
                <h2>🎓 Graduation Ceremony Details</h2>
                <p><strong>Date:</strong> September 19, 2025</p>
                <p><strong>Time:</strong> 6:00 PM | Graduates are requested to arrive at 4:00 PM</p>
                <p><strong>Venue:</strong> Résidence des Pins</p>
                
                <div class="divider"></div>
                
                <p>Below is the information you submitted for your guests:</p>
                ${attendeeListItems}
                
                <p>If any of the above details are incorrect or need to be updated, please click the link below to make changes:</p>
                
                <p><a href="${modificationLink}" style="color: #602060;">Update Guest Information</a></p>
                
                <p>Please note:</p>
                <ul>
                    <li>Each graduate is allowed two guest cards only.</li>
                    <li>Résidence des Pins has <strong>strict security policies</strong> – the names must match the guests' official IDs.</li>
                    <li>No one will be admitted without proper ID matching the submitted names.</li>
                </ul>
                
                <p>To avoid any inconvenience, kindly complete any updates <strong>by June 23, 2025</strong>.</p>
                
                <p>Thank you for your cooperation, and we look forward to celebrating together!</p>
                
                <p>Best regards,<br>
                ESA team</p>
            </div>
            `;
        }

        // Send email with appropriate template
        await transporter.sendMail({
            from: process.env.EMAIL_FROM,
            to: graduate.email,
            subject: emailSubject,
            html: emailContent
        });

        return res.status(200).json({
            message: 'Attendee registration successful. Please check your email for the confirmation.'
        });

    } catch (error) {
        console.error('Attendee registration error:', error);
        return res.status(500).json({ message: 'An error occurred during attendee registration' });
    }
});

// Level 3: Get Attendee Information for Modification
app.get('/api/registration/level3/:token', async (req, res) => {
    const { token } = req.params;

    try {
        // Verify token and get graduate
        const [graduates] = await pool.execute(
            'SELECT id, first_name, last_name FROM graduates WHERE registration_token = ? AND token_expiry > NOW()',
            [token]
        );

        if (graduates.length === 0) {
            return res.status(404).json({ message: 'Invalid or expired registration link' });
        }

        const graduate = graduates[0];

        // Get attendees
        const [attendees] = await pool.execute(
            'SELECT id, first_name, last_name, date_of_birth FROM attendees WHERE graduate_id = ?',
            [graduate.id]
        );

        return res.status(200).json({
            graduate: {
                firstName: graduate.first_name,
                lastName: graduate.last_name
            },
            attendees: attendees.map(attendee => ({
                id: attendee.id,
                firstName: attendee.first_name,
                lastName: attendee.last_name,
                dateOfBirth: attendee.date_of_birth
            }))
        });

    } catch (error) {
        console.error('Get attendee error:', error);
        return res.status(500).json({ message: 'An error occurred while retrieving attendee information' });
    }
});

// Level 3: Update Attendee Information
app.put('/api/registration/level3/:token', async (req, res) => {
    const { token } = req.params;
    const { attendees } = req.body;

    try {
        // Verify token and get graduate
        const [graduates] = await pool.execute(
            'SELECT id FROM graduates WHERE registration_token = ? AND token_expiry > NOW()',
            [token]
        );

        if (graduates.length === 0) {
            return res.status(404).json({ message: 'Invalid or expired registration link' });
        }

        const graduate = graduates[0];

        // Update attendees
        if (attendees && attendees.length > 0) {
            for (const attendee of attendees) {
                if (attendee.id) {
                    // Update existing attendee
                    await pool.execute(
                        `UPDATE attendees 
             SET first_name = ?, last_name = ?, date_of_birth = ? 
             WHERE id = ? AND graduate_id = ?`,
                        [attendee.firstName, attendee.lastName, attendee.dateOfBirth.split('T')[0], attendee.id, graduate.id]
                    );
                } else {
                    // Add new attendee
                    await pool.execute(
                        'INSERT INTO attendees (graduate_id, first_name, last_name, date_of_birth) VALUES (?, ?, ?, ?)',
                        [graduate.id, attendee.firstName, attendee.lastName, attendee.dateOfBirth]
                    );
                }
            }
        }

        // Mark registration as complete
        await pool.execute(
            'UPDATE graduates SET registration_complete = TRUE WHERE id = ?',
            [graduate.id]
        );

        return res.status(200).json({
            message: 'Attendee information updated successfully.'
        });

    } catch (error) {
        console.error('Update attendee error:', error);
        return res.status(500).json({ message: 'An error occurred while updating attendee information' });
    }
});

// ===== ADMIN API ROUTES =====
app.post('/api/admin/create', async (req, res) => {
    try {
        const {username, password, email} = req.body;
        let saltRounds = 10;
        const hashPassword = await bcrypt.hash(password, saltRounds);

        const [result] = await pool.execute(
            `INSERT INTO administrators
                 (username, password, email, role)
             VALUES (?, ?, ?, ?)`,
            [username, hashPassword, email, 'admin']
        );
        return res
            .status(201)
            .json({success: true, code: 201, message: "User successfully created"});
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            code: 500,
            message: "internal server error",
            error: error.message,
        });
    }
});


// Admin Login
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    try {
        // Get admin user
        const [admins] = await pool.execute(
            'SELECT * FROM administrators WHERE username = ?',
            [username]
        );

        if (admins.length === 0) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        const admin = admins[0];

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, admin.password);

        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        // Update last login
        await pool.execute(
            'UPDATE administrators SET last_login = NOW() WHERE id = ?',
            [admin.id]
        );

        // Generate JWT token
        const token = jwt.sign(
            { id: admin.id, username: admin.username, role: admin.role },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        return res.status(200).json({
            token,
            user: {
                id: admin.id,
                username: admin.username,
                email: admin.email,
                role: admin.role
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ message: 'An error occurred during login' });
    }
});

// Get All Graduate Registrations
app.get('/api/admin/registrations', authenticate, async (req, res) => {
    try {
        // Get all graduates with registration information
        const [graduates] = await pool.execute(`
      SELECT 
        g.id, g.first_name, g.last_name, g.email, g.promotion, 
        g.is_attending, g.registration_complete, COUNT(a.id) as attendee_count
      FROM 
        graduates g
      LEFT JOIN 
        attendees a ON g.id = a.graduate_id
      GROUP BY 
        g.id
      ORDER BY 
        g.last_name, g.first_name
    `);

        return res.status(200).json({
            graduates: graduates.map(g => ({
                id: g.id,
                firstName: g.first_name,
                lastName: g.last_name,
                email: g.email,
                promotion: g.promotion,
                isAttending: !!g.is_attending,
                registrationComplete: !!g.registration_complete,
                attendeeCount: g.attendee_count
            }))
        });

    } catch (error) {
        console.error('Get registrations error:', error);
        return res.status(500).json({ message: 'An error occurred while retrieving registrations' });
    }
});

// Get Graduate Details with Attendees
app.get('/api/admin/registrations/:id', authenticate, async (req, res) => {
    const { id } = req.params;

    try {
        // Get graduate information
        const [graduates] = await pool.execute(
            'SELECT * FROM graduates WHERE id = ?',
            [id]
        );

        if (graduates.length === 0) {
            return res.status(404).json({ message: 'Graduate not found' });
        }

        const graduate = graduates[0];

        // Get attendees
        const [attendees] = await pool.execute(
            'SELECT * FROM attendees WHERE graduate_id = ?',
            [id]
        );

        return res.status(200).json({
            graduate: {
                id: graduate.id,
                firstName: graduate.first_name,
                lastName: graduate.last_name,
                email: graduate.email,
                promotion: graduate.promotion,
                isAttending: !!graduate.is_attending,
                registrationComplete: !!graduate.registration_complete,
                registrationStage: graduate.registration_stage,
                registrationDate: graduate.registration_date,
                lastUpdated: graduate.last_updated
            },
            attendees: attendees.map(a => ({
                id: a.id,
                firstName: a.first_name,
                lastName: a.last_name,
                dateOfBirth: a.date_of_birth
            }))
        });

    } catch (error) {
        console.error('Get graduate details error:', error);
        return res.status(500).json({ message: 'An error occurred while retrieving graduate details' });
    }
});

// Generate Invitation Links (for Admin)
app.post('/api/admin/generate-invitations', authenticate, async (req, res) => {
    const { graduates } = req.body;

    if (!graduates || !Array.isArray(graduates) || graduates.length === 0) {
        return res.status(400).json({ message: 'Graduate list is required' });
    }

    try {
        const results = [];

        for (const graduate of graduates) {
            // Create a unique token
            const token = crypto.randomBytes(32).toString('hex');
            const tokenExpiry = getTokenExpiryDate(); // Set expiry to June 23, 2025

            // Check if graduate exists
            const [rows] = await pool.execute(
                'SELECT * FROM graduates WHERE email = ?',
                [graduate.email]
            );

            if (rows.length === 0) {
                // Insert new graduate
                const [result] = await pool.execute(
                    `INSERT INTO graduates 
            (email, first_name, last_name, promotion, registration_token, token_expiry) 
           VALUES (?, ?, ?, ?, ?, ?)`,
                    [graduate.email, graduate.firstName || '', graduate.lastName || '', graduate.promotion || '', token, tokenExpiry]
                );

                results.push({
                    email: graduate.email,
                    token,
                    link: `${process.env.FRONTEND_URL}/registration/level1/${token}`
                });
            } else {
                // Update existing graduate
                await pool.execute(
                    `UPDATE graduates 
           SET registration_token = ?, token_expiry = ?, registration_stage = 1, registration_complete = FALSE
           WHERE email = ?`,
                    [token, tokenExpiry, graduate.email]
                );

                results.push({
                    email: graduate.email,
                    token,
                    link: `${process.env.FRONTEND_URL}/registration/level1/${token}`
                });
            }
        }

        return res.status(200).json({
            message: `Successfully generated ${results.length} invitation links`,
            invitations: results
        });

    } catch (error) {
        console.error('Generate invitations error:', error);
        return res.status(500).json({ message: 'An error occurred while generating invitation links' });
    }
});

// Send Batch Invitation Emails
app.post('/api/admin/send-invitations', authenticate, async (req, res) => {
    const { emails } = req.body;

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ message: 'Email list is required' });
    }

    try {
        const results = [];

        for (const email of emails) {
            // Get graduate with token
            const [graduates] = await pool.execute(
                'SELECT first_name, last_name, registration_token FROM graduates WHERE email = ?',
                [email]
            );

            if (graduates.length === 0) {
                results.push({
                    email,
                    status: 'error',
                    message: 'Graduate not found'
                });
                continue;
            }

            const graduate = graduates[0];
            const registrationLink = `${process.env.FRONTEND_URL}/registration/level1/${graduate.registration_token}`;

            // Send invitation email
            /*
            await transporter.sendMail({
                from: process.env.EMAIL_FROM,
                to: email,
                subject: 'ESA Graduation Ceremony - Registration',
                html: `
          <p>Dear ${graduate.first_name || 'Graduate'} ${graduate.last_name || ''},</p>
          <p>We are pleased to invite you to register for the upcoming ESA graduation ceremony.</p>
          <p>Please click the link below to confirm your attendance:</p>
          <p><a href="${registrationLink}">Graduation Registration</a></p>
          <p>Best regards,<br>ESA Team</p>
        `,
            }); */

            results.push({
                email,
                status: 'success',
                message: 'Invitation sent successfully'
            });
        }

        return res.status(200).json({
            message: `Sent ${results.filter(r => r.status === 'success').length} invitations`,
            results
        });

    } catch (error) {
        console.error('Send invitations error:', error);
        return res.status(500).json({ message: 'An error occurred while sending invitation emails' });
    }
});

// Create/Update Admin
app.post('/api/admin/users', authenticate, async (req, res) => {
    // Check if user is admin
    if (req.user.role !== 'admin') {
        return res.status(403).json({message: 'Unauthorized'});
    }

    const {username, email, password, role} = req.body;

    if (!username || !email || !role) {
        return res.status(400).json({message: 'Username, email and role are required'});
    }

    try {
        // Check if username exists
        const [users] = await pool.execute(
            'SELECT * FROM administrators WHERE username = ? OR email = ?',
            [username, email]
        );

        // Hash password if provided
        let hashedPassword;
        if (password) {
            hashedPassword = await bcrypt.hash(password, 10);
        }

        if (users.length === 0) {
            // Create new admin
            if (!password) {
                return res.status(400).json({message: 'Password is required for new users'});
            }

            await pool.execute(
                'INSERT INTO administrators (username, email, password, role) VALUES (?, ?, ?, ?)',
                [username, email, hashedPassword, role]
            );

            return res.status(201).json({message: 'Admin user created successfully'});
        } else {
            // Update existing admin
            const updateFields = [];
            const updateValues = [];

            if (email !== users[0].email) {
                updateFields.push('email = ?');
                updateValues.push(email);
            }

            if (role !== users[0].role) {
                updateFields.push('role = ?');
                updateValues.push(role);
            }

            if (hashedPassword) {
                updateFields.push('password = ?');
                updateValues.push(hashedPassword);
            }

            if (updateFields.length > 0) {
                updateValues.push(users[0].id);

                await pool.execute(
                    `UPDATE administrators
                     SET ${updateFields.join(', ')}
                     WHERE id = ?`,
                    updateValues
                );

                return res.status(200).json({message: 'Admin user updated successfully'});
            }

            return res.status(200).json({message: 'No changes made'});
        }

    } catch (error) {
        console.error('Admin user error:', error);
        return res.status(500).json({message: 'An error occurred while processing admin user'});
    }
});