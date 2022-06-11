const express = require('express')
const cors = require('cors');
require ('dotenv').config();
const app = express()
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 4000;

app.use(cors())
app.use(express.json())


const uri = `mongodb+srv://${process.env.NAME}:${process.env.PASS}@cluster0.aza55.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


function jwtVerify (req,res,next){
  const authHeader = req.headers.authorization;
  if(!authHeader){
    return res.status(401).send({message : "Unauthorized User"})
  }
  const token = authHeader.split(' ')[1];
  jwt.verify(token , process.env.SECRET_TOKEN,function(err,decoded){
    if(err){
      console.log(err);
      return res.status(403).send({message : "Forbidden User"})
    }
    
    req.decoded =decoded;
    // console.log(decoded);
    next();
  })
}
async function run() {
    try {
        await client.connect();
        const portalCollection = client.db("Doctor_Portal").collection("services");
        const BookingsCollection = client.db("Doctor_Portal").collection("Bookings");
        const UsersCollection = client.db("Doctor_Portal").collection("users");
        const doctorsCollection = client.db("Doctor_Portal").collection("doctors");
        const paymentCollection = client.db("Doctor_Portal").collection("payments");


        const verifyAdmin = async(req,res,next)=>{
          const requester = req.decoded.email;
          const requesterAccount = await UsersCollection.findOne({email : requester})
          if(requesterAccount.Role==="Admin"){
            next();
          }
          else{
            res.status(403).send({message:"Forbidden user"})
          }
        
        }

        app.get('/user',async(req,res)=>{
          const users = await UsersCollection.find().toArray();
            res.send(users)
        })

        app.get('/admin/:email',async(req,res)=>{
          const email = req.params.email;
          const user=await UsersCollection.findOne({email:email})
          const isAdmin = user.Role==='Admin';
          res.send({Admin:isAdmin})
        
        })

        app.post("/create-payment-intent",async(req,res)=>{
          const {price} = req.body;
          const amount = price*100;
          const paymentIntent = await stripe.paymentIntents.create({
            amount:amount,
            currency:"usd",
            payment_method_types:['card']
          });
          res.send({clientSecret : paymentIntent.client_secret})
           
        })


        app.put('/user/:email',async(req,res)=>{
          const email = req.params.email;
          const user = req.body;
          const filter = {email: email};
          const options = {upsert : true}
          const updateDoc= {
            $set:user
          };
          const result = await UsersCollection.updateOne(filter,updateDoc,options);
          const token = jwt.sign({ email:email},process.env.SECRET_TOKEN,{expiresIn:'12hr'});
          res.send({result , token})
        })
        app.put('/user/admin/:email', async(req,res)=>{
          const email = req.params.email;
            const filter = {email: email};
            const updateDoc= {
              $set:{Role:'Admin'},
            };  
          const result = await UsersCollection.updateOne(filter,updateDoc);
          res.send(result)
        
        })

        app.get('/service', async(req,res)=>{
            const query = {}
            const cursor = portalCollection.find(query).project({name:1})
            const result = await cursor.toArray()
            res.send(result);
        })

        app.get('/booking', async(req,res)=>{

          const patientEmail = req.query.patientEmail;
          // const decodedEmail = req.decoded.email;
          // console.log(decodedEmail);
          // const {email, ...rest}=decodedEmail;
          // console.log(decodedEmail,req.decoded.email );
          // if(decodedEmail === patientEmail){
            const query = {patientEmail:patientEmail};
            const bookings = await BookingsCollection.find(query).toArray();
            res.send(bookings);
          // }
          // else{
          //   return res.status(403).send({message : "Forbidden User"})
          // }
       
        })

        app.patch('/booking/:id',async(req,res)=>{
          const id = req.params.id;
          const payment = req.body;
          const filter = {_id: ObjectId(id)}
          const updateDoc = {
            $set:{
              paid:true,
              transactionId : payment.transactionId,
            }
          }
          const result = await paymentCollection.insertOne(payment)
          const updateBooking = await BookingsCollection.updateOne(filter,updateDoc)
          res.send(updateBooking)
        })

        app.post('/booking' , async(req,res)=>{
          const booking = req.body;
          const query = {treatment : booking.treatment , date:booking.date , patientEmail:booking.patientEmail}
    
          const exits = await BookingsCollection.findOne(query);
          if(exits){
            return res.send({success : false,booking:exits})
          }
          const result =await BookingsCollection.insertOne(booking);
            return res.send({success : true , result})
        })

        app.get('/booking/:id', async(req,res)=>{
          const id =req.params.id;
          const query = {_id:ObjectId(id)}
          const bookings = await BookingsCollection.findOne(query);
          res.send(bookings)
        })

        app.get('/doctor', async(req,res)=>{
          const doctor = await doctorsCollection.find().toArray();
          res.send(doctor)
        })



        app.get('/available', async(req,res)=>{
          const date = req.query.date;

          // step 1:  get all services
          const services = await portalCollection.find().toArray();
    
          // step 2: get the booking of that day. output: [{}, {}, {}, {}, {}, {}]
          const query = {date: date};
          const bookings = await BookingsCollection.find(query).toArray();
    
          // step 3: for each service
          services.forEach(service=>{
            // step 4: find bookings for that service. output: [{}, {}, {}, {}]
            const serviceBookings = bookings.filter(book => book.treatment === service.name);
            // step 5: select slots for the service Bookings: ['', '', '', '']
            const bookedSlots = serviceBookings.map(book => book.slot);
            // service.booked=serviceBookings.map(s=> s.slot)
            // step 6: select those slots that are not in bookedSlots
            const available = service.slots.filter(slot => !bookedSlots.includes(slot));
            // console.log(available);
            //step 7: set available to slots to make it easier 
            service.slots = available;
          });

          res.send(services);
        });

        app.post('/doctor', async(req,res)=>{
          const doctor = req.body;
          const result = await doctorsCollection.insertOne(doctor)
          res.send(result);
        })

        app.delete('/doctor/:email', async(req,res)=>{
          const email = req.params.email;
          const filter = {email:email}
          const result = await doctorsCollection.deleteOne(filter)
          res.send(result);
        })



        
    }
    finally {
        // await client.close();

      }
}


run().catch(console.dir);





app.get('/', (req, res) => {
  res.send('Hello from doctor')
})

app.listen(port, () => {
  console.log(` Done With Doctor ${port}`)
})