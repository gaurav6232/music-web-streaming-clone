var express = require('express');
var router = express.Router();
var users = require('../models/userModel');
var songModel = require('../models/songModel')
var playlistModel = require('../models/playlistModel')
const passport = require('passport');
var localStrategy = require('passport-local')
const mongoose = require('mongoose')
var multer = require('multer')
var id3 = require('node-id3')
const {Readable} = require('stream')
var crypto = require('crypto');
const userModel = require('../models/userModel');

passport.use(new localStrategy(users.authenticate()))



mongoose.connect('mongodb://0.0.0.0/ar-N15').then(() =>{
  console.log('connected to database')
}).catch(err =>{
  console.log(err)
})


const conn = mongoose.connection

var gfsBucket, gfsBucketPoster
conn.once('open',() =>{
  gfsBucket = new mongoose.mongo.GridFSBucket(conn.db,{
    bucketName: 'audio'
  })
  gfsBucketPoster = new mongoose.mongo.GridFSBucket(conn.db,{
    bucketName: 'poster'
  })

})

 

router.post('/register', async (req, res, next) =>{
  var newUser = {
    username: req.body.username,
    email: req.body.email
  };
  users.register(newUser,req.body.password)
  .then((result) =>{
    passport.authenticate('local')(req, res,async() =>{


      const songs = await songModel.find()


      const defaultplaylist = await playlistModel.create({
        name: req.body.username,
        owner: req.user._id,
        songs: songs.map(song =>song._id)

      })

      console.log(songs.map(song=>song._id))

      const newUser = await userModel.findOne({
        _id: req.user._id
      })

      newUser.playlist.push(defaultplaylist._id)

      await newUser.save()
 



      res.redirect('/')
    });
  })

  .catch((err) =>{
    res.send(err);
  });
});


router.get('/auth',(req, res, next) =>{
  res.render('register')
})


router.post('/login', passport.authenticate('local',{
  successRedirect: '/',
  failureRedirect: '/login',
}) 
);

router.get('/logout', (req, res,next) =>{
  if (req.isAuthenticated())
  req.logout((err) =>{
    if(err) res.send(err);
    else res.redirect('/');
  });
  else{
    res.redirect('/')
  }
});


function isloggedIn(req, res, next){
  if(req.isAuthenticated()){
    return next();
  }
  else res.redirect('/auth');
}


function isAdmin(req, res, next){
  if(req.user.isAdmin)return next()
  else return res.redirect('/')
}



/* GET home page. */
router.get('/', isloggedIn, async function(req, res, next) {
  try {
    const currentUser = await userModel.findOne({
      _id: req.user._id
    }).populate('playlist').populate({
      path: 'playlist',
      populate: {
        path: 'songs',
        model: 'song'
      }
    });
    const allSongs = await songModel.find();

    // Fetch all songs belonging to the current user
    

    res.render('index', { allSongs }); // Pass 'allSongs' to the template
  } catch (error) {
    console.error(error);
    res.status(500).send('An error occurred.');
  }
});




router.get('/poster/:posterName',(req,res, next)=>{
  gfsBucketPoster.openDownloadStreamByName(req.params.posterName).pipe(res)
})





const storage = multer.memoryStorage()
const upload = multer({ storage: storage })

router.post('/uploadMusic', isloggedIn, upload.array('song'), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).send('No files were uploaded.');
    }

    // Create an array to store the IDs of newly uploaded songs
    const newSongIds = [];

    await Promise.all(req.files.map(async (file) => {
      const randomName = crypto.randomBytes(20).toString('hex');
      
      // Validate the file type or size before processing
      if (!file.mimetype.startsWith('audio/')) {
        throw new Error('Invalid file type. Only audio files are allowed.');
      }
      
      // Read ID3 metadata from the uploaded file
      const songData = id3.read(file.buffer);
      
      // Upload the file and associated poster image to GridFS
      await Promise.all([
        Readable.from(file.buffer).pipe(gfsBucket.openUploadStream(randomName)),
        Readable.from(songData.image.imageBuffer).pipe(gfsBucketPoster.openUploadStream(randomName + 'poster'))
      ]);

      // Create a new song document in the database
      const newSong = await songModel.create({
        title: songData.title,
        artist: songData.artist,
        album: songData.album,
        size: file.size,
        poster: randomName + 'poster',
        filename: randomName,
      });

      // Add the ID of the newly uploaded song to the array
      newSongIds.push(newSong._id);
    }));

    // Fetch the current user and update their playlist with the newly uploaded songs
    const currentUser = await userModel.findOneAndUpdate(
      { _id: req.user._id },
      { $push: { playlist: { $each: newSongIds } } },
      { new: true }
    );

    // Fetch all songs belonging to the current user
    const allSongs = await songModel.find({ _id: { $in: currentUser.playlist } });

    // Render the 'index' template with the current user and all songs
    res.render('index', { currentUser, allSongs });
  } catch (err) {
    console.error(err);
    res.status(500).send('An error occurred while uploading the songs.');
  }
});




router.get('/uploadMusic',isloggedIn,(req,res,next) =>{
  // console.log(req.user)
  res.render('uploadMusic')
})


router.get('/stream/:musicName', async (req,res,next) =>{
  const currentSong = await songModel.findOne({
    filename: req.params.musicName
  })

  const stream = gfsBucket.openDownloadStreamByName(req.params.musicName)
  res.set('Content-Type','audio/mpeg')
  res.set("Content-Length", currentSong.size + 1)
  res.set('Content-Range', `bytes 0-${currentSong.size - 1}/${currentSong.size}`)
  res.set('Content-Ranges', 'byte')
  res.status(206)
  stream.pipe(res)
  
})




router.get('/search',(req,res,next) =>{
  res.render('search')
})


router.post('/search', async (req,res,next) =>{
  const searchedMusic = await songModel.find({
    title:{$regex: req.body.search}
  })
  res.json({
    songs: searchedMusic
  })
})


module.exports = router;
