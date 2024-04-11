const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const verifySid = process.env.VERIFY_SID;
const client = require("twilio")(accountSid, authToken);

const userH = require("../helpers/userHelper");
const productH = require("../helpers/productHelper");
const orderH = require("../helpers/orderHelper");
const adminH = require("../helpers/adminHelper");
const { request } = require("express");
const otp = require("../config/otp");
const { sentOTP } = require("../config/phoneOtp");
const { verify } = require("crypto");
const { stopCoverage } = require("v8");

module.exports = {
  loginpage: (req, res) => {
    if (req.session.loggedIn) {
      res.redirect("/");
    } else {
      res.render("users/login");
    }
  },
  userAuth: async (req, res) => {
    const valid = await userH.validUser(req.body.email);

    if (!valid) {
      res.render("users/login", { invalid: "invalid email" });
    } else {
      if (valid.status === "block") {
        res.render("users/login", { invalid: "Your account has been blocked" });
      } else {
        const currentPassword = await bcrypt.compare(
          req.body.password,
          valid.password
        );
        if (currentPassword) {
          req.session.userId = valid._id;
          req.session.loggedIn = true;
          if (req.session.cart && req.session.cart.length > 0) {
            let cartItems = req.session.cart.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              price: item.price,
            }));

            await userH.pushMultipleToCart(cartItems, valid._id);
            delete req.session.cart;
            console.log("session cart emptied", req.session.cart);
          }
          console.log("User logged in");
          res.redirect("/");
        } else {
          res.render("users/login", { invalid: "invalid password" });
        }
      }
    }
  },

  signpage: (req, res) => {
    res.render("users/signup");
  },
  signUp: async function (req, res) {
    const { name, email, password, phone } = req.body;
    try {
      console.log(req.body);

      // Check if user with the same email or phone already exists
      const existingUser = await userH.existUser(email, phone);
      if (existingUser) {
        return res.json({ invalid: "existing Email or Phone" });
      }

      // Hash password
      const hashpassword = await bcrypt.hash(password, 10);

      // Construct user details object
      const userDetails = {
        name: name,
        email: email,
        password: hashpassword,
        phone: phone,
      };

      // Save user details in session

      await userH.insertData(userDetails);
      req.session.data = userDetails;
      console.log(req.session.data);
    } catch (error) {
      console.error(error);
      return res.json({ error: "name should atleast 4 characters long" });
    }
    if (req.session.data) {
      // Send OTP
      const otpData = await sentOTP(phone);
      console.log("OTP sent:", otpData.phone);
      return res.json({ phone: otpData.phone, message: "" });
    }
  },
  otppage: async (req, res) => {
    const phone = req.session.data.phone;
    console.log("phone number:", phone);
    await userH.otpfaileddelete(phone);

    res.render("users/otp", { phone: phone });
  },

  verifyOTP: async function (req, res) {
    const otpDigits = req.body.code; // Correctly extract OTP digits
    const phone = req.body.phone;
    console.log("phone number:", phone);

    try {
      const verifiedResponse = await client.verify.v2
        .services(verifySid)
        .verificationChecks.create({
          to: `+91${phone}`,
          code: otpDigits,
        });
      console.log(verifiedResponse.status);
      if (verifiedResponse.status === "approved") {
        console.log("otp verification successful");
        const { name, email, password, phone } = req.session.data;

        const userdata = {
          name: name,
          email: email,
          password: password,
          phone: phone,
        };
        const verify = true;
        if (verify === true) {
          await userH.insertData(userdata);
          res.redirect("/users/login");
        }
      } else {
        const verify = false;
        // Handle if verification status is not approved
        console.log("OTP verification failed");
        res.render("users/otp", {
          phone: phone,
          message: "OTP verification failed",
        });
      }
    } catch (error) {
      // Handle error from Twilio
      console.error(error);
      res.json({ error: "Internal Server Error" });
    }
  },
  //resend otp
  resendotp: async (req, res) => {
    try {
      const phone = req.session.data.phone;
      console.log(phone + "resending");

      const data = await sentOTP(phone);

      console.log(data.phone + "resended successfully");
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to resend OTP" });
    }
  },

  logout: (req, res) => {
    req.session.destroy();
    res.redirect("/");
  },
  allproducts: async (req, res) => {
    console.log("id-" + req.session.userId);

    const prodata = await productH.allproducts();
    const isUser = req.session.loggedIn;
    res.render("users/allproducts", { prodata, isUser });
  },
  viewcart: async (req, res) => {
    let isUser = req.session.loggedIn || false;
    const user =req.session.loggedIn
    let userid = req.session.userId || null;
    let cartItems = [];

    try {
      // Check if the user is logged in and fetch their cart items from the database
      if (userid) {
        const cartProduct = await userH.findProduct(userid);
        if (cartProduct && cartProduct.cart) {
          cartItems = cartProduct.cart.cart || [];
        }
      }

      // Check if there are any items in the session cart and append them to the cartItems array
      if (req.session.cart && req.session.cart.length > 0) {
        cartItems = cartItems.concat(req.session.cart);
      }

      let cartlength = cartItems.length;
      let cartcount = cartlength >0 ? cartlength : null
      let sum1 = cartItems.reduce((sum, item) => sum + item.price, 0);
      let totalSum = sum1 + 5;
      let stock = true;
      cartItems.forEach((item) => {
        if (item.productId.quantity === 0) {
          stock = false;
        }
      });
      res.render("users/cart", {
        cartItems,
        totalSum,
        cartcount,
        sum1,
        isUser,
        stock,
        user
      });
    } catch (error) {
      console.error("Error rendering cart page:", error);
      res.status(500).send("Internal Server Error");
    }
  },

  addTocart: async (req, res) => {
    const Productid = req.params.id;
    const Product = await productH.findItem(Productid);
    const stock = Product.quantity;
    if (!Product) {
      return res.status(404).send("Product not found");
    }

    const Price = Product.price;
    console.log(Price);

    try {
      if (req.session.loggedIn) {
        // If user is logged in, add product to their cart in the database
        const userid = req.session.userId;
        const arrayItems = {
          productid: Productid,
          quantity: 1,
          price: Price,
        };
        await userH.pushTOcart(arrayItems, userid, stock);
        try {
          const user = await userH.findProduct(userid);
          let cartcount = 0;
          if (user && user.cart && user.cart.cart) {
            cartcount = user.cart.cart.length;
          }

          // Send the updated cart count along with the response
          res.json({ success: true, message: "Item added to cart", cartcount });
        } catch (error) {
          console.error("Error adding item to cart:", error);
          res
            .status(500)
            .json({ success: false, message: "Failed to add item to cart" });
        }
      } else {
        // If user is not logged in, add product to the session cart
        if (!req.session.cart) {
          req.session.cart = [];
        }
        const existingCartItemIndex = req.session.cart.findIndex(
          (item) => item.productId === Productid
        );

        if (existingCartItemIndex !== -1) {
          req.session.cart[existingCartItemIndex].quantity++;
        } else {
          req.session.cart.push({
            productId: Productid,
            quantity: 1,
            price: Price,
            image: Product.image,
            productname: Product.productname,
          });
          try {
            let cartcount = 0;
            if (req.session.cart) {
              cartcount = req.session.cart.length;
            }
  
            // Send the updated cart count along with the response
            res.json({ success: true, message: "Item added to cart", cartcount });
          } catch (error) {
            console.error("Error adding item to cart:", error);
            res
              .status(500)
              .json({ success: false, message: "Failed to add item to cart" });
          }
        }
      }

      // res.redirect("/");
    } catch (error) {
      console.error(error);
      res.status(500).send("Internal Server Error");
    }
  },

  quantityUpdate: async (req, res) => {
    const userid = req.session.userId;
    var cartProduct = await userH.findProduct(userid);
    const cart = cartProduct.cart.cart;
    let updatedprice;
    let totalSum;

    const { productId, action } = req.body;
    // console.log(productId, action);
    // console.log(req.body);
    const product = await productH.findItem(productId);
    const stock = product.quantity;

    // console.log('stock',stock.quantity);
    try {
      if (action == "increase") {
        const updatedquantity = await userH.updateCartInc(
          userid,
          productId,
          stock
        );

        // if(updatedquantity<=stock.quantity){
        // updated cart
        var cartProductF = await userH.findProduct(userid);

        let sum = 0;
        cartProductF.cart.cart.forEach((item) => {
          if (item.productId._id == productId) {
            updatedprice = item.productId.price * updatedquantity;

            userH.updateUserCart(userid, productId, updatedprice);
          }
          sum += item.productId.price * item.quantity;
          // console.log('itemquantity',item.quantity);
        });

        totalSum = sum + 5;

        // console.log('updatedprice',updatedprice);
        // console.log('sum',sum);

        // console.log('last updated qty',updatedquantity);
        res.json({
          quantity: updatedquantity,
          price: updatedprice,
          cartSum: sum,
          cartTotal: totalSum,
        });
        // }
        // else{
        //     res.json('outofstock')
        // }
      } else {
        if (action == "decrease") {
          const updatedquantity = await userH.updateCartDec(userid, productId);

          // updated cart
          var cartProductF = await userH.findProduct(userid);
          let sum = 0;

          cartProductF.cart.cart.forEach((item) => {
            if (item.productId._id == productId) {
              updatedprice = item.productId.price * updatedquantity;

              userH.updateUserCart(userid, productId, updatedprice);
            }

            sum += item.productId.price * item.quantity;
          });

          totalSum = sum + 5;
          // console.log('updatedprice',updatedprice);

          // console.log('last updated qty',updatedquantity);
          res.json({
            quantity: updatedquantity,
            price: updatedprice,
            cartSum: sum,
            cartTotal: totalSum,
          });
        }
      }
    } catch (error) {
      console.error("inc/dec issue", error);
    }
  },
  cartItemRemove: async (req, res) => {
    const userid = req.session.userId;
    const { productId } = req.body;
    // console.log('for removing:',productId)
    // console.log('userid:',userid);
    let sum = 0;
    try {
      const updatedCart = await userH.removeItem(userid, productId);
      //   console.log('updatedCartaaaaaa',updatedCart);
      updatedCart.forEach((item) => {
        sum += item.price * item.quantity;
        // console.log('sum',sum);
      });
      const cartCount = updatedCart.length;
      let totalSum;
      if (sum == 0) {
        totalSum = 0;
      } else {
        totalSum = sum + 5;
      }

      // Send the response
      res.json({
        success: true,
        cartSum: sum,
        cartTotal: totalSum,
        cartCount: cartCount,
      });
    } catch (error) {
      console.error("remove issue", error);
      res.json({ success: false });
    }
  },
  productpage: async (req, res) => {
    const productId = req.params.id;
    const item = await productH.findItem(productId);
    const isUser = req.session.loggedIn;
    // console.log('product',product);

    res.render("users/productpage", { item, isUser });
  },
  edituser: async (req, res) => {
    const userid = req.session.userId;
    const data = await userH.findedituserbyid(userid);
    console.log(data);

    res.render("users/profile", { data: data });
  },
  updateuser: async (req, res) => {
    const userid = req.params.id;
    const datas = {
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
    };
    console.log(datas);
    await userH.insertupdate(datas, userid);
    res.redirect("/users/profile");
  },
  forgotpassword: async (req, res) => {
    res.render("users/forgotpassword");
  },
  validateotp: async (req, res) => {
    const result = await userH.findedituserbyid(req.body.id);
    if (req.body.enteredOTP && result) {
      if (result.verification == req.body.enteredOTP) {
        await userH.verified(req.body.id);
        res.json({ success: true });
        await userH.gmail(result.email, result.name); //welcome mail
        res.render("users/login");
      } else {
        await userH.delete(req.body._id);
        res.json({ success: false });
      }
    } else {
      await userH.delete(req.body._id);
      res.status(422).json({ error: "Field can't be empty!" });
    }
  },
  timeexeed: async (req, res) => {
    const proid = req.params.id;
    await userH.delete(proid);
    res.render("users/signup");
  },
  sendotp: async (req, res) => {
    const result = await userH.validUser(req.body.email);
    if (result) {
      const generatedotp = await otp.generateOTP();
      await otp.sendOTPEmail(req.body.email, generatedotp);
      res.json(generatedotp);
    } else {
      res.json({ error: "error" });
    }
  },
  resetpassword: async (req, res) => {
    const hashpassword = await bcrypt.hash(req.body.newPassword, 10);
    await userH.forgotpassword(req.body.email, hashpassword);
    res.json("success");
  },
  userproductdetail: async (req, res) => {
    const id = req.params.id;
    const productid = await orderH.productdetail(id);
    const product = await productH.findingproducts(productid);

    res.render("users/productdetails", { product });
  },
  addtoWishlist: async (req, res) => {
    const productId = req.params.id;
    const userId = req.session.userId;
    try {
      existingItem = await userH.findwishlist(userId, productId);
      if (existingItem) {
        const Remove = await userH.removeItemfromWishlist(userId, productId);
        res.json({ success: false });
      } else {
        let wishlist = await userH.findwishlistUser(userId);
        if (!wishlist) {
          wishlist = userH.createemptyWishlist(userId);
        }
        wishlist.products.push(productId);
        await wishlist.save();
        res.json({ success: true });
      }
    } catch (error) {
      console.error("wishlist error", error);
    }
  },
  wishlist: async (req, res) => {
    const isUser = req.session.loggedIn;
    const userId = req.session.userId;
    const cartProduct = await userH.findProduct(userId);
    const cartlength= cartProduct.cart.cart.length
    const cartcount =cartlength > 0 ? cartlength : null
    const wishlist = await userH.findingwishlistProducts(userId);
    if (!wishlist || wishlist.products.length === 0) {
      res.render("users/wishlist", { wishlist: [], isUser: isUser ,cartcount });
    } else {
      res.render("users/wishlist", {
        wishlist: wishlist.products,
        isUser: isUser, cartcount
      });
    }
  },
  deleteWishlist: async (req, res) => {
    try {
      const userId = req.session.userId;
      const productId = req.body.productId;
      const removeItem = await userH.removeItemfromWishlist(userId, productId);
      if (removeItem) {
        res.json({ success: false });
      } else {
        res.json({ error: "Product not found in the wishlist" });
      }
    } catch (error) {
      console.log("error in delete to wishlist");
    }
  },
  applyCoupon: async (req, res) => {
    try {
      const couponCode = req.body.couponCode;
      const userId = req.session.userId;
      const coupon = await adminH.findCouponByCode(couponCode);
      const disPrice = coupon.amount;
      const cart = await userH.findProduct(userId);
      const productId = cart.cart.productId;
      if (cart.totalsum >= 10000) {
        const grandtotal = cart.totalsum - disPrice;
        await userH.updateUsercoupon(userId, couponCode);

        res.json({ success: true, grandtotal, disPrice });
      } else {
        res.json({
          success: false,
          message: "Cart value should be more than 10000 to apply this coupon",
        });
      }
    } catch (error) {
      console.log("coupon not applied", error);
    }
  },
  removeCoupon: async (req, res) => {
    try {
      const userId = req.session.userId;
      await userH.removeUpdate(userId);
      res.json({ success: true });
    } catch (error) {
      console.log("error in remove coupon", error);
    }
  },
  getCartCount: async (req, res) => {
    const userId = req.session.userId;
    const user = await userH.findProduct(userId);
    let cartCount = 0;
    if (user && user.cart && user.cart.cart) {
      cartCount = user.cart.cart.length;
    }
    res.json({ cartCount });
  },
};
