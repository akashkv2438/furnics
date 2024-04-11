const razorpay = require("../config/razorpay");
const orderH = require("../helpers/orderHelper");
const userH = require("../helpers/userHelper");
const adminH =require("../helpers/adminHelper")
const crypto = require("crypto");

module.exports = {
  checkOut: async (req, res) => {
    const userid = req.session.userId;
    const cartProduct = await userH.findProduct(userid);
    const user =await userH.findedituserbyid(userid)
    const address=user.address
    const coupon = await adminH.findCouponByCode(user.couponCode);
    const coupons =await adminH.findCoupon()
    const disprice = coupon ? coupon.amount : 0;
    // const product =cartProduct.cart.cart
    
    // console.log(stock);
    let totalPay = 0;
    
    if (cartProduct.cart.cart.length > 0) {
      if (cartProduct.totalPrice == 0) {
        totalPay = 0;
      } else {
        totalPay = cartProduct.totalPrice + 5;
      }
      if(user.coupon == "applied" && cartProduct.totalPrice >=10000){
        totalPay = totalPay - disprice
        res.render("users/checkout", {
          cart: cartProduct.cart.cart,
          totalPrice: cartProduct.totalPrice,
          applied: true,
          totalPay,
          address,
          coupons,
          coupon,
          disprice
        });

      }
      else{
        res.render("users/checkout", {
          cart: cartProduct.cart.cart,
          totalPrice: cartProduct.totalPrice,
          applied: false,
          totalPay,
          address,
          coupons
        });
      }
    }
    //  else {
    //   res.json({ error: "Item is out of stock" });
    // }
  },
  postCheckout: async (req, res) => {
    const userid = req.session.userId;
    const user = await userH.findProduct(userid);
    const Cart = user.cart.cart;
    const timestamp = Date.now();
    const randomNum = Math.floor(Math.random() * 1000);
    const orderId = `ORD-${timestamp}-${randomNum}`;
    const price = req.body.price

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
          totalprice: price,
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
          var order = await razorpay.payment(orderId, price);
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

    if (digest === signature) {
      console.log("payment successful");
      orderH.updatestatus(orderID, paymentId);
      userH.updateSuccesscoupon(userid)
      orderH.deleteCartorderd(userid);
      res.json("success");
    } else {
      res.json("failed");
    }
  },
  success: (req, res) => {
    res.render("users/paymentsuccess");
  },
  findorders: async (req, res) => {
    const userid = req.session.userId;
    const isUser = req.session.loggedIn;
    const cartProduct = await userH.findProduct(userid);
    const cartlength= cartProduct.cart.cart.length
    const cartcount =cartlength > 0 ? cartlength : null

    const orders = await orderH.orderfinding(userid);

    res.render("users/myorders", { orders, isUser, cartcount });
  },
  
};
