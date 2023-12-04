const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

//middleware
app.use(cors());
app.use(express.json());

const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
  CURSOR_FLAGS,
} = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.8sb7n8j.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const userCollection = client.db("hostelDB").collection("users");
    const paymentCollection = client.db("hostelDB").collection("payments");
    const mealsCollection = client.db("hostelDB").collection("meals");
    const reqMealsCollection = client.db("hostelDB").collection("reqMeals");
    const upcomingMealsCollection = client
      .db("hostelDB")
      .collection("upcomingMeals");

    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unautorized" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized" });
        }
        req.decoded = decoded;
        next();
      });
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden" });
      }
      next();
    };

    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/user/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded?.email) {
        return res.status(403).send({ message: "forbidden" });
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "User already exists", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.patch("/user/package", verifyToken, async (req, res) => {
      try {
        const email = req.decoded.email;
        const user = await userCollection.findOne({ email });
        const userId = user._id;
        if (!user) {
          return res
            .status(404)
            .json({ success: false, message: "User not found" });
        }

        const updatedUser = await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { package: req.body.package } }
        );
        console.log(userId);

        res.json({
          success: true,
          message: "User package updated successfully",
        });
      } catch (error) {
        console.error("Error updating user package:", error);
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });
    app.get("/user/package/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded?.email) {
        return res.status(403).send({ message: "forbidden" });
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      let package = null;
      if (user) {
        package = user?.package;
      }
      res.send({ package });
    });

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.get("/meals", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const pageSize = parseInt(req.query.pageSize) || 10;
        const skip = (page - 1) * pageSize;

        const result = await mealsCollection
          .find()
          .skip(skip)
          .limit(pageSize)
          .toArray();

        const totalMeals = await mealsCollection.estimatedDocumentCount();

        res.send({
          data: result,
          pagination: {
            total: totalMeals,
            pageSize,
            current: page,
          },
        });
      } catch (error) {
        console.error("Error fetching meals:", error);
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });

    app.get("/mealsCount", async (req, res) => {
      const count = await mealsCollection.estimatedDocumentCount();
      res.send({ count });
    });

    app.get("/meals/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await mealsCollection.findOne(query);
      res.send(result);
    });

    app.post("/meals", verifyToken, verifyAdmin, async (req, res) => {
      const menuItem = req.body;
      const result = await mealsCollection.insertOne(menuItem);
      res.send(result);
    });

    app.patch("/meals/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const item = req.body;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          admin_email: item.admin_email,
          admin_name: item.admin_name,
          description: item.description,
          ingredients: item.ingredients,
          meal_title: item.meal_title,
          meal_type: item.meal_type,
          likes: item.likes,
          reviews: item.reviews,
          rating: item.rating,
          time_date: item.time_date,
          price: item.price,
          image: item.image,
        },
      };
      const result = await mealsCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    app.delete("/meals/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await mealsCollection.deleteOne(query);
      res.send(result);
    });
    app.post("/reqMeal", verifyToken, async (req, res) => {
      const menuItem = req.body;
      const result = await reqMealsCollection.insertOne(menuItem);
      res.send(result);
    });

    app.post("/meal/like/:id", async (req, res) => {
      const mealId = req.params.id;
      try {
        const query = { _id: new ObjectId(mealId) };
        const update = { $inc: { likes: 1 } };
        const result = await mealsCollection.updateOne(query, update);
        if (result.matchedCount === 0) {
          return res
            .status(404)
            .json({ success: false, message: "Meal not found" });
        }
        const updatedMeal = await mealsCollection.findOne(query);
        return res.json({ success: true, likes: updatedMeal.likes });
      } catch (error) {
        console.error("Error liking meal:", error);
        return res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });

    app.post("/upcomingMeals", verifyToken, verifyAdmin, async (req, res) => {
      const menuItem = req.body;
      const result = await upcomingMealsCollection.insertOne(menuItem);
      res.send(result);
    });

    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.get("/payments/:email", verifyToken, async (req, res) => {
      const query = { email: req.params.email };
      if (req.params.email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden" });
      }
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);
      res.send({ paymentResult });
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hostel Management server is running");
});
app.listen(port, () => {
  console.log(`Hostel Management server is port ${port}`);
});
