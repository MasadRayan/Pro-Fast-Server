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
        const ridersCollections = client.db("parcelDB").collection("riders")

        // custome middleware******************
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
                req.decoded = decoded;
                next();
            } catch (err) {
                return res.status(403).send({ message: "Forbiddem Access" });
            }
        };


        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email }
            const user = await usersCollections.findOne(query);
            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: "Forbiddem Access" });
            }
            next();
        }


        // UserApi *******************

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

        app.get('/users/search', async (req, res) => {
            const email = req.query.email;
            if (!email) {
                return res.status(400).send({ error: 'Email query parameter is required' });
            }
            try {
                const users = await usersCollections
                    .find({ email: { $regex: email, $options: 'i' } }) // case-insensitive partial
                    .limit(10)
                    .toArray();

                if (users.length === 0) {
                    return res.status(404).send({ error: 'No users found' });
                }
                res.send(users);
            } catch (err) {
                console.error(err);
                res.status(500).send({ error: 'Internal Server Error' });
            }
        });

        app.get('/users/:email/role', async (req, res) => {
            const email = req.params.email;

            if (!email) {
                return res.status(400).send({ error: 'Email parameter is required' });
            }

            try {
                const user = await usersCollections.findOne(
                    { email: { $regex: `^${email}$`, $options: 'i' } },  // case-insensitive
                    { projection: { role: 1, _id: 0 } }
                );

                if (!user) {
                    return res.status(404).send({ error: 'User not found' });
                }

                res.send({ role: user.role || 'user' });
            } catch (err) {
                console.error(err);
                res.status(500).send({ error: 'Internal Server Error' });
            }
        });


        app.patch('/users/:id/role',verifyFBToken, verifyAdmin,  async (req, res) => {
            const id = req.params.id;
            const { role } = req.body;

            if (!role) {
                return res.status(400).send({ error: 'Role is required in request body' });
            }

            try {
                const result = await usersCollections.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role } }
                );

                if (result.modifiedCount === 0) {
                    return res.status(404).send({ error: 'User not found or role unchanged' });
                }

                res.send({ message: `User role updated to ${role}` });
            } catch (err) {
                console.error(err);
                res.status(500).send({ error: 'Internal Server Error' });
            }
        });


        // parcel api***************************

        app.post("/parcels", async (req, res) => {
            const parcel = req.body;
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


        // payment api*******************************
        app.get("/payments", verifyFBToken, async (req, res) => {

            try {
                const email = req.query.email;

                if (req.decoded.email !== email) {
                    return res.status(403).send({ message: "Forbiddem Access" });
                }

                const query = email ? { email } : {};
                const payments = await paymentCollection
                    .find(query)
                    .sort({ createdAt: -1 })
                    .toArray();

                res.send(payments);
            } catch (err) {
                res.status(500).send({ error: err.message });
            }
        });

        app.post("/payments", async (req, res) => {
            const { parcelId, email, amount, transactionId } = req.body;

            try {
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



        // rider Api***********************************
        app.post('/riders', async (req, res) => {
            const rider = req.body;
            const result = await ridersCollections.insertOne(rider);
            res.send(result)
        })

        app.get('/riders/pending', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const pendingRiders = await ridersCollections.find({ status: "pending" }).toArray();
                res.send(pendingRiders);
            } catch (error) {
                console.error("Error fetching pending riders:", error);
                res.status(500).send({ message: "Internal server error" });
            }
        });

        app.delete("/riders/:id", async (req, res) => {
            const id = req.params.id;

            try {
                const result = await ridersCollections.deleteOne({ _id: new ObjectId(id) });

                if (result.deletedCount === 0) {
                    return res.status(404).send({ message: "Rider not found" });
                }

                res.send({ message: "Rider rejected & removed successfully" });

            } catch (err) {
                res.status(500).send({ error: err.message });
            }
        });


        app.get('/riders/approved', verifyFBToken, verifyAdmin,  async (req, res) => {
            try {
                const pendingRiders = await ridersCollections.find({ status: "approved" }).toArray();
                res.send(pendingRiders);
            } catch (error) {
                console.error("Error fetching pending riders:", error);
                res.status(500).send({ message: "Internal server error" });
            }
        });

        app.patch("/riders/:id/status", async (req, res) => {
            const id = req.params.id;
            const { status, email } = req.body;

            if (!status) {
                return res.status(400).send({ message: "Status is required" });
            }

            const filter = { _id: new ObjectId(id), status: "pending" };
            const update = { $set: { status } };

            try {
                const result = await ridersCollections.updateOne(filter, update);

                // update the role of a rider
                if (status === 'approved' && email) {
                    const useQuery = { email: { $regex: `^${email}$`, $options: "i" } };

                    const roleResult = await usersCollections.updateOne(useQuery, { $set: { role: 'rider' } });

                    console.log("Role update result:", roleResult);
                }

                res.send(result);

            } catch (err) {
                console.error(err);
                res.status(500).send({ error: err.message });
            }
        });

        app.patch("/riders/:id/deactivate", async (req, res) => {
            const id = req.params.id;

            try {
                const result = await ridersCollections.updateOne(
                    { _id: new ObjectId(id), status: 'approved' },
                    { $set: { status: "deactivated" } }
                );

                if (result.modifiedCount === 0) {
                    return res.status(404).send({ message: "Rider not found or already deactivated" });
                }

                res.send({ message: "Rider deactivated successfully" });

            } catch (err) {
                res.status(500).send({ error: err.message });
            }
        });


        // Tracking Api*************************
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


        // Payment Api*****************************
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
