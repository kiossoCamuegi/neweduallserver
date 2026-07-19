const GoogleSrategy = require("passport-google-oauth20").Strategy;
const FacebookStrategy =  require("passport-facebook").Strategy;
const passport = require("passport");
const GOOGLE_CLIENT_ID ="959711940394-fj8mibr45d9oobr98cttg1e696vaiod4.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET ="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"; 


const FACEBOOK_APP_ID = "000";
const FACEBOOK_APP_SECRET = "000";
const URL = "/";


passport.use("google_signin",new GoogleSrategy({
    clientID:GOOGLE_CLIENT_ID,
    clientSecret:GOOGLE_CLIENT_SECRET,
    callbackURL: URL+"auth/googlesignin/callback",
    passReqToCallback: true
  },
  function(request, accessToken, refreshToken, profile, done) { 
      return done(null,profile); 
  }
));



passport.use("google_signup",new GoogleSrategy({
  clientID:GOOGLE_CLIENT_ID,
  clientSecret:GOOGLE_CLIENT_SECRET,
  callbackURL: URL+"auth/googlesignup/callback",
  passReqToCallback: true
},
function(request, accessToken, refreshToken, profile, done) { 
    return done(null,profile); 
}));


passport.serializeUser((user, done)=>{
    done(null, user)
})

passport.deserializeUser((user, done)=>{
    done(null, user)
})



passport.use(new FacebookStrategy({
    clientID:FACEBOOK_APP_ID,
    clientSecret: FACEBOOK_APP_SECRET,
    callbackURL: URL+"auth/facebook/callback"
  },
  function(request, accessToken, refreshToken, profile, done) { 
    return done(null,profile); 
  }
));