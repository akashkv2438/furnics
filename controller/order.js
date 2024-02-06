const razorpay = require("../config/razorpay");
const orderH = require("../helpers/orderHelper");
const userH = require("../helpers/userHelper");
const crypto = require("crypto");

module.exports = {
  checkOut: async (req, res) => {
    const userid = req.session.userId;
    const cartProduct = await userH.findProduct(userid);
    let totalPay = 0;
    if (cartProduct) {
      if (cartProduct.totalPrice == 0) {
        totalPay = 0;
      } else {
        totalPay = cartProduct.totalPrice + 5;
      }
      res.render("users/checkout", {
        cart: cartProduct.cart.cart,
        totalPrice: cartProduct.totalPrice,
        totalPay,
      });
    } else {
      res.redirect("/users/cart");
      console.log("cartData not found");
    }
  },
  postCheckout: async (req, res) => {
    const userid = req.session.userId;
    const user = await userH.findProduct(userid);
    const Cart = user.cart.cart;
    console.log(req.body);
    const timestamp = Date.now();
    const randomNum = Math.floor(Math.random() * 1000);
    const orderId = `ORD-${timestamp}-${randomNum}`;

    try {
      if (user) {
        const orderDetails = {
          userid: userid,
          orderid: orderId,
          orderdate: new Date(),
          name: req.body.name,
          phone: req.body.phone,
          pincode: req.body.pincode,
          landmark: req.body.landmark,
          address: req.body.address,
          city: req.body.city,
          state: req.body.state,
          cart: Cart,
          status: "pending",
          totalprice: user.totalPrice + 5,
          paymentid: "null",
          paymentmethod: req.body.paymentOption,
        };
        if(req.body.paymentOption === "cod"){
            orderDetails.status = "placed";
            await orderH.addOrder(orderDetails);
            orderH.deleteCartorderd(userid);

            res.json("success");

        }
        else
        if (req.body.paymentOption === "razorpay") {
          var order = await razorpay.payment(orderId, orderDetails.totalprice);
          await orderH.addOrder(orderDetails);
          res.json(order);


        }

        const newAddress = {
          userId: userid,
          address: {
            name: req.body.name,
            phone: req.body.phone,
            pincode: req.body.pincode,
            landmark: req.body.landmark,
            address: req.body.address,
            city: req.body.city,
            state: req.body.state,
          },
        };
        const existAddress = await orderH.existAddress(newAddress);

        if (!existAddress) {
          await orderH.addAddress(req.body, userid);
        }

      }
    } catch (error) {
      console.log(error);
    }
  },
  verifyPayment: (req, res) => {
    const userid = req.session.userId;
    const paymentId = req.body["payment[razorpay_payment_id]"];
    const orderId = req.body["payment[razorpay_order_id]"];
    const signature = req.body["payment[razorpay_signature]"];
    const orderID = req.body.orderID;

    //algorithm for checking the payid+orderid=signature
    const hash = crypto.createHmac("sha256", process.env.key_secret);
    hash.update(orderId + "|" + paymentId);
    const digest = hash.digest("hex");
    console.log("digest", digest);

    if (digest === signature) {
      console.log("payment successful");
      orderH.updatestatus(orderID, paymentId);
      orderH.deleteCartorderd(userid);
      res.json("success");
    } else {
      console.log("payment failed");
      res.json("failed");
    }
  },
  success: (req, res) => {
    res.render("users/paymentsuccess");
  },
  findorders: async (req, res) => {
    const userid = req.session.userId;
    const isUser = req.session.loggedIn;

    const orders = await orderH.orderfinding(userid);

    res.render("users/myorders", { orders, isUser });
  },
};
