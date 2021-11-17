const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
const { MongoClient } = require('mongodb');
const ObjectId = require('mongodb').ObjectId;
require('dotenv').config();
var admin = require("firebase-admin");
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const fileUpload = require('express-fileupload');

// var serviceAccount = require("./doctors-portal-org-firebase-adminsdk-n4che-c13a3a22ce.json");
var serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

app.use(cors());
app.use(express.json());
app.use(fileUpload());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ombkm.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

const verifyToken = async (req, res, next) => {
    if (req.headers?.authorization?.startsWith('Bearer ')) {
        const idToken = req.headers.authorization.split('Bearer ')[1];
        try {
            const decodedUser = await admin.auth().verifyIdToken(idToken);
            req.decodedUserEmail = decodedUser.email;
        }
        catch {

        }
    }
    next();
}

const runDoctorsPortalDatabase = async () => {
    try {
        await client.connect();
        const database = client.db('DoctorsPortalDB');
        const usersCollection = database.collection('users');
        const appointmentsCollection = database.collection('appointments');
        const doctorsCollection = database.collection('doctors');

        // userlist
        app.get('/users', async (req, res) => {
            const cursor = usersCollection.find({});
            const users = await cursor.toArray();
            res.send(users);
        })
        // single user-details
        app.get('/users/details/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const user = usersCollection.findOne(query);
            res.send(user);
        })
        // login-registration
        // normal email
        app.post('/users', async (req, res) => {
            const newUser = req.body;
            console.log(req.body);
            const result = await usersCollection.insertOne(newUser);
            res.json(result);
        })
        // google email
        app.put('/users', async (req, res) => {
            const gmailUser = req.body;
            console.log(gmailUser);
            const filter = { email: gmailUser.email };
            const updateDoc = {
                $set: gmailUser
            }
            const options = { upsert: true };
            const result = await usersCollection.updateOne(filter, updateDoc, options);
            res.json(result);
        })
        // delete a user
        app.delete('/users/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const result = await usersCollection.deleteOne(filter);
            res.json(result);
        })
        // admin role check by email
        app.get('/users/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            let isAdmin = false;
            if (user?.role === 'admin') {
                isAdmin = true;
            }
            res.send({ isAdmin });
        })
        // make admin by email
        app.put('/users/admins', verifyToken, async (req, res) => {
            // input email
            const email = req.body.email;
            const requester = req.decodedUserEmail;
            // authorized logged-in email
            if (requester) {
                const query = { email: requester };
                const requesterAccount = await usersCollection.findOne(query);
                // admin identified
                if (requesterAccount.role === 'admin') {
                    const filter = { email: email };
                    const updateDoc = {
                        $set: { role: 'admin' }
                    }
                    const result = await usersCollection.updateOne(filter, updateDoc);
                    res.json(result);
                }
            }
            else {
                res.status(401).send({ message: `Warning! You don't have permission to access this page` });
            }

        })
        // without verifying token - make admin by email
        app.put('/users/admins/without-jwt', async (req, res) => {
            const newAdmin = req.body;
            const filter = { email: newAdmin.email };
            const updateDoc = {
                $set: { role: 'admin' }
            }
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.json(result);
        })
        // get authorized appointment data by email and date
        app.get('/appointments', verifyToken, async (req, res) => {
            const email = req.query.email;
            const date = req.query.date;
            if (req.decodedUserEmail === email) {
                const query = { email: email, date: date };
                const appointments = await appointmentsCollection.find(query).toArray();
                res.send(appointments);
            }
            else {
                res.status(401).json({ message: 'Email Not Authorized!' });
            }
        })
        // get appointment data by email and date
        app.get('/appointments/without-jwt', async (req, res) => {
            const email = req.query.email;
            const date = req.query.date;
            const query = { email: email, date: date };
            const appointments = await appointmentsCollection.find(query).toArray();
            res.send(appointments);
        })
        app.get('/appointments/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const appointment = await appointmentsCollection.findOne(query);
            res.send(appointment);
        })
        // create appointment
        app.post('/appointments', async (req, res) => {
            const newUser = req.body;
            const result = await appointmentsCollection.insertOne(newUser);
            res.json(result);
        })
        app.put('/appointments/:id', async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updateDoc = {
                $set: {
                    payment: payment
                }
            }
            const result = await appointmentsCollection.updateOne(filter, updateDoc);
            res.json(result);
        })

        app.post('/create-payment-intent', async (req, res) => {
            const paymentInfo = req.body;
            const amount = paymentInfo.price * 100; // convert $ to cents [1$= 100cents]
            const paymentIntent = await stripe.paymentIntents.create({
                currency: 'USD',
                amount: amount,
                payment_method_types: ['card']
            })
            res.json({ clientSecret: paymentIntent.client_secret });
        })
        app.get('/doctors', async (req, res) => {
            const doctors = await doctorsCollection.find({}).toArray();
            res.send(doctors);
        })
        app.post('/doctors', async (req, res) => {
            const name = req.body.name;
            const email = req.body.email;
            const pic = req.files.image;
            const picData = pic.data;
            const encodedPic = picData.toString('base64');
            const imageBuffer = Buffer.from(encodedPic, 'base64');
            const newDoctor = {
                name,
                email,
                image: imageBuffer
            }
            const result = await doctorsCollection.insertOne(newDoctor);
            res.json(result);
        })
    }
    finally {
        // await client.close();
    }
}
runDoctorsPortalDatabase().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Doctors Portal server is running...');
})
app.listen(port, () => {
    console.log('Listening on port ' + port);
})