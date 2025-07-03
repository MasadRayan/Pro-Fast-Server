const express = require('express')
const app = express()
require('dotenv').config();
const cors = require('cors');
const port = process.env.PORT || 3000
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);
const admin = require("firebase-admin");

// Middleware
app.use(cors());
app.use(express.json());


const serviceAccount = require("./pro-fast.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.df8vtvh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const parcelCollection = client.db("parcelDB").collection("parcels");
        const paymentCollection = client.db("parcelDB").collection('payments');
        const trackingCollection = client.db("parcelDB").collection("tracking");
        const usersCollections = client.db("parcelDB").collection('users')

        // custome middleware
        const verifyFBToken = async (req, res, next) => {
            const authHeader = req.headers.authorization;

            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                return res.status(401).send({ message: "Unauthorized: No token provided" });
            }

            const token = authHeader.split(" ")[1];
            if (!token) {
                return res.status(401).send({ message: "Unauthorized: No token provided" });
            }

            // verify the token

            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded; // contains uid, email, etc.
                next();
            } catch (err) {
                return res.status(403).send({ message: "Forbiddem Access" });
            }
        };

        app.post('/users', async (req, res) => {
            const email = req.body.email;
            const userExists = await usersCollections.findOne({ email })
            if (userExists) {
                return res.status(200).send({ message: "User already exists", inserted: false });
            }
            const user = req.body
            const result = await usersCollections.insertOne(user);
            res.send(result)
        })

        app.post("/parcels", async (req, res) => {
            const parcel = req.body;
            //   parcel.status = "Pending Pickup";
            const result = await parcelCollection.insertOne(parcel);
            res.send(result);
        });

        app.get("/parcels", verifyFBToken, async (req, res) => {
            const email = req.query.email;

            if (req.decoded.email !== email) {
                return res.status(403).send({ message: "Forbiddem Access" });
            }

            const query = email ? { email } : {};

            const parcels = await parcelCollection
                .find(query)
                .sort({ createdAt: -1 })
                .toArray();
            res.send(parcels);
        });

        app.get("/parcels/:id", verifyFBToken, async (req, res) => {
            const id = req.params.id;
            try {
                const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });
                if (!parcel) {
                    return res.status(404).send({ message: "Parcel not found" });
                }
                res.send(parcel);
            } catch (err) {
                res.status(500).send({ error: err.message });
            }
        });


        app.delete("/parcels/:id", async (req, res) => {
            const id = req.params.id;
            try {
                const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (err) {
                res.status(500).send({ error: err.message });
            }
        });



        app.get("/payments", verifyFBToken, async (req, res) => {

            try {
                const email = req.query.email;

                if (req.decoded.email !== email) {
                    return res.status(403).send({ message: "Forbiddem Access" });
                }

                const query = email ? { email } : {};
                const payments = await paymentCollection
                    .find(query)
                    .sort({ createdAt: -1 })  // latest on top
                    .toArray();

                res.send(payments);
            } catch (err) {
                res.status(500).send({ error: err.message });
            }
        });

        app.post("/payments", async (req, res) => {
            const { parcelId, email, amount, transactionId } = req.body;

            try {
                // 1. Mark parcel as Paid
                const updateResult = await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            paymentStatus: "Paid"
                        }
                    }
                );

                if (updateResult.modifiedCount === 0) {
                    return res.status(404).send({ message: "Parcel not found or already paid" });
                }

                // 2. Add to payments history
                const paymentRecord = {
                    parcelId,
                    email,
                    amount,
                    status: "Paid",
                    transactionId,
                    createdAt_string: new Date().toISOString(),
                    createdAt: new Date(),
                };

                const paymentResult = await paymentCollection.insertOne(paymentRecord);

                res.send({
                    message: "Payment recorded and parcel marked as Paid",
                    insertedId: paymentResult.insertedId
                });

            } catch (err) {
                res.status(500).send({ error: err.message });
            }
        });

        app.post("/tracking", async (req, res) => {
            const { parcelId, trackingId, status, message, note = '' } = req.body;

            const trackingRecord = {
                parcelId,
                trackingId,
                status,
                message,
                note,
                updatedAt: new Date()
            };

            try {
                const result = await trackingCollection.insertOne(trackingRecord);
                res.send({
                    message: "Tracking update added",
                    trackingId: result.insertedId
                });
            } catch (err) {
                res.status(500).send({ error: err.message });
            }
        });


        app.post('/create-payment-intent', async (req, res) => {
            const amountIncents = req.body.amountInCents
            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amountIncents, // amount in cents
                    currency: 'usd',
                    payment_method_types: ['card'],
                });
                res.json({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });



        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {

        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('The server in running!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
