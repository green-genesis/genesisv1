// app.js
require('dotenv').config(); // Load environment variables
const express = require('express'); // Web framework
const bodyParser = require('body-parser'); // Middleware to parse request bodies
const i18n = require('i18n'); // Internationalization
const session = require('express-session'); // Session management
const bcrypt = require('bcrypt'); // Password hashing
const path = require('path'); // File and directory paths (built-in Node.js module)
const sqlite3 = require('sqlite3').verbose(); // SQLite database library
const axios = require('axios'); // HTTP requests
const multer = require('multer'); // File upload handling
const fs = require('fs'); // File system module
const { Configuration, OpenAIApi } = require('openai'); // OpenAI integration

const app = express();

// Set up EJS as the templating engine
app.set('view engine', 'ejs');

// Set static folder for public assets
app.use(express.static(path.join(__dirname, 'public')));

// Body parser middleware
app.use(bodyParser.json({ limit: '50mb' })); // Increase limit to handle image data
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Session management
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

// Internationalization (i18n) configuration
i18n.configure({
  locales: ['en', 'ar'],
  directory: path.join(__dirname, 'locales'),
  defaultLocale: 'en',
  cookie: 'lang',
});
app.use(i18n.init);

// Database setup
const db = new sqlite3.Database('./database.db');

// Initialize the database tables
db.serialize(() => {
  // Users table
  db.run(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT
    )`
  );

  // Greenhouses table
  db.run(
    `CREATE TABLE IF NOT EXISTS greenhouses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      owner_id INTEGER,
      plant_id INTEGER,
      FOREIGN KEY(owner_id) REFERENCES users(id),
      FOREIGN KEY(plant_id) REFERENCES plants(id)
    )`
  );

  // Sensor data table
  db.run(
    `CREATE TABLE IF NOT EXISTS sensor_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      greenhouse_id INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      soil_moisture REAL,
      water_level REAL,
      ph_level REAL,
      co2_level REAL,
      nitrogen REAL,
      phosphorus REAL,
      potassium REAL,
      light_intensity REAL,
      FOREIGN KEY(greenhouse_id) REFERENCES greenhouses(id)
    )`
  );

  // Issues table for debugging simulation
  db.run(
    `CREATE TABLE IF NOT EXISTS issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      greenhouse_id INTEGER,
      description TEXT,
      resolved INTEGER DEFAULT 0,
      FOREIGN KEY(greenhouse_id) REFERENCES greenhouses(id)
    )`
  );

  // Plants table
  db.run(
    `CREATE TABLE IF NOT EXISTS plants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      temp_min REAL,
      temp_max REAL,
      humidity_min REAL,
      humidity_max REAL,
      co2_min REAL,
      co2_max REAL,
      soil_moisture_min REAL,
      soil_moisture_max REAL,
      ph_min REAL,
      ph_max REAL,
      nitrogen_min REAL,
      nitrogen_max REAL,
      phosphorus_min REAL,
      phosphorus_max REAL,
      potassium_min REAL,
      potassium_max REAL,
      light_min REAL,
      light_max REAL
    )`
  );

  // Control commands table
  db.run(
    `CREATE TABLE IF NOT EXISTS control_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      greenhouse_id INTEGER,
      device TEXT,
      action TEXT,
      executed INTEGER DEFAULT 0,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(greenhouse_id) REFERENCES greenhouses(id)
    )`
  );

  // Insert plant data if the table is empty
  db.get('SELECT COUNT(*) AS count FROM plants', (err, row) => {
    if (err) throw err;
    if (row.count === 0) {
      const insertPlant = db.prepare(`
        INSERT INTO plants (name, temp_min, temp_max, humidity_min, humidity_max, co2_min, co2_max,
          soil_moisture_min, soil_moisture_max, ph_min, ph_max, nitrogen_min, nitrogen_max,
          phosphorus_min, phosphorus_max, potassium_min, potassium_max, light_min, light_max)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const plantsData = [
        ['Tomato', 18.0, 29.0, 60.0, 80.0, 350.0, 1000.0, 60.0, 80.0, 6.0, 6.8, 50.0, 200.0,
          20.0, 60.0, 40.0, 80.0, 20000.0, 40000.0],
        ['Lettuce', 10.0, 20.0, 60.0, 80.0, 350.0, 800.0, 70.0, 90.0, 6.0, 7.0, 30.0, 100.0,
          10.0, 30.0, 20.0, 50.0, 15000.0, 30000.0],
        // Add more plants as needed
      ];

      plantsData.forEach((plant) => {
        insertPlant.run(plant, (err) => {
          if (err) {
            console.error('Error inserting plant data:', err.message);
          }
        });
      });

      insertPlant.finalize();
    }
  });
});

// Middleware to set locale based on query parameter
app.use((req, res, next) => {
  const lang = req.query.lang || req.getLocale();
  res.setLocale(lang);
  next();
});

// Middleware for authentication
function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  } else {
    res.redirect('/login');
  }
}

// Middleware for role-based access
function requireRole(role) {
  return function (req, res, next) {
    if (req.session && req.session.role === role) {
      next();
    } else {
      res.status(403).send('Forbidden');
    }
  };
}

// Middleware for API key authentication
function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === process.env.API_KEY) {
    return next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// OpenAI Configuration
const openaiApi = new OpenAIApi(
  new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  })
);

// Set up multer for handling image uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Routes

// Home page
app.get('/', (req, res) => {
  res.render('home', { session: req.session });
});

// Register page
app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

// Handle registration
app.post('/register', async (req, res) => {
  const { username, password, role } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  db.run(
    `INSERT INTO users (username, password, role) VALUES (?, ?, ?)`,
    [username, hashedPassword, role],
    function (err) {
      if (err) {
        res.render('register', { error: 'Username already exists' });
      } else {
        res.redirect('/login');
      }
    }
  );
});

// Login page
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// Handle login
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (err || !user) {
      res.render('login', { error: 'Invalid username or password' });
    } else {
      const match = await bcrypt.compare(password, user.password);
      if (match) {
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role;
        res.redirect('/dashboard');
      } else {
        res.render('login', { error: 'Invalid username or password' });
      }
    }
  });
});

// Dashboard
app.get('/dashboard', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const role = req.session.role;

  if (role === 'technician') {
    // Technician dashboard
    db.all(`SELECT * FROM issues WHERE resolved = 0`, (err, issues) => {
      if (err) throw err;
      res.render('technician-dashboard', { username: req.session.username, issues: issues });
    });
  } else {
    // Farmer dashboard
    db.all('SELECT * FROM plants', (err, plants) => {
      if (err) throw err;
      db.all(
        `SELECT g.*, p.name as plant_name FROM greenhouses g LEFT JOIN plants p ON g.plant_id = p.id WHERE owner_id = ?`,
        [userId],
        (err, greenhouses) => {
          if (err) throw err;
          res.render('farmer-dashboard', {
            username: req.session.username,
            greenhouses: greenhouses,
            plants: plants,
          });
        }
      );
    });
  }
});

// Add greenhouse
app.post('/add-greenhouse', isAuthenticated, (req, res) => {
  const { name, plant_id } = req.body;
  const ownerId = req.session.userId;

  db.run(
    `INSERT INTO greenhouses (name, owner_id, plant_id) VALUES (?, ?, ?)`,
    [name, ownerId, plant_id],
    function (err) {
      if (err) throw err;
      res.redirect('/dashboard');
    }
  );
});

// View greenhouse data
app.get('/greenhouse/:id', isAuthenticated, (req, res) => {
  const greenhouseId = req.params.id;
  const userId = req.session.userId;
  const role = req.session.role;

  // Check ownership or technician access
  db.get(
    `SELECT g.*, p.name as plant_name FROM greenhouses g LEFT JOIN plants p ON g.plant_id = p.id WHERE g.id = ? AND (g.owner_id = ? OR ? = 'technician')`,
    [greenhouseId, userId, role],
    (err, greenhouse) => {
      if (err || !greenhouse) {
        res.status(403).send('Forbidden');
      } else {
        // Fetch sensor data
        db.all(
          `SELECT * FROM sensor_data WHERE greenhouse_id = ? ORDER BY timestamp DESC LIMIT 20`,
          [greenhouseId],
          (err, data) => {
            if (err) throw err;

            // Fetch pending commands
            db.all(
              `SELECT * FROM control_commands WHERE greenhouse_id = ? AND executed = 0 ORDER BY timestamp ASC`,
              [greenhouseId],
              (err, commands) => {
                if (err) throw err;
                res.render('greenhouse', { greenhouse: greenhouse, data: data, commands: commands });
              }
            );
          }
        );
      }
    }
  );
});

// Analyze plant image (uploaded via web interface)
app.post(
  '/greenhouse/:id/analyze-image',
  isAuthenticated,
  upload.single('plant_image'),
  async (req, res) => {
    const greenhouseId = req.params.id;
    const userId = req.session.userId;
    const lang = req.getLocale();

    // Check ownership
    db.get(
      `SELECT g.*, p.* FROM greenhouses g LEFT JOIN plants p ON g.plant_id = p.id WHERE g.id = ? AND g.owner_id = ?`,
      [greenhouseId, userId],
      async (err, greenhouse) => {
        if (err || !greenhouse) {
          res.status(403).send('Forbidden');
        } else {
          if (!req.file) {
            res.status(400).send('No image uploaded.');
            return;
          }

          try {
            // Since OpenAI's GPT models cannot process images directly, we simulate analysis
            const analysisText = lang === 'ar'
              ? 'تحليل الصورة: النبات يبدو صحيًا، لا توجد علامات على الأمراض.'
              : 'Image Analysis: The plant appears healthy with no signs of diseases.';

            res.render('analysis', { greenhouse: greenhouse, analysis: analysisText });
          } catch (error) {
            console.error('Error during image analysis:', error);
            res.status(500).send('Error analyzing image.');
          }
        }
      }
    );
  }
);

// Control devices in the greenhouse
app.post('/greenhouse/:id/control', isAuthenticated, (req, res) => {
  const greenhouseId = req.params.id;
  const userId = req.session.userId;
  const { device, action } = req.body;

  // Check ownership
  db.get(
    `SELECT * FROM greenhouses WHERE id = ? AND owner_id = ?`,
    [greenhouseId, userId],
    (err, greenhouse) => {
      if (err || !greenhouse) {
        res.status(403).send('Forbidden');
      } else {
        // Store the command in the database
        db.run(
          `INSERT INTO control_commands (greenhouse_id, device, action) VALUES (?, ?, ?)`,
          [greenhouseId, device, action],
          function (err) {
            if (err) {
              res.status(500).send('Error storing command.');
            } else {
              res.json({ status: 'success', message: `Command ${device}:${action} stored.` });
            }
          }
        );
      }
    }
  );
});

// Debugging panel (simulate issues)
app.get('/debug', isAuthenticated, requireRole('technician'), (req, res) => {
  // Fetch unresolved issues
  db.all(`SELECT * FROM issues WHERE resolved = 0`, (err, issues) => {
    if (err) throw err;
    res.render('debug', { issues: issues });
  });
});

// Simulate an issue
app.post('/simulate-issue', isAuthenticated, requireRole('technician'), (req, res) => {
  const { greenhouseId, description } = req.body;
  const pin = req.body.pin;

  if (pin === process.env.DEBUG_PIN) {
    db.run(
      `INSERT INTO issues (greenhouse_id, description) VALUES (?, ?)`,
      [greenhouseId, description],
      function (err) {
        if (err) throw err;
        res.redirect('/debug');
      }
    );
  } else {
    res.status(403).send('Incorrect PIN');
  }
});

// Resolve an issue
app.post('/resolve-issue/:id', isAuthenticated, requireRole('technician'), (req, res) => {
  const issueId = req.params.id;
  db.run(`UPDATE issues SET resolved = 1 WHERE id = ?`, [issueId], function (err) {
    if (err) throw err;
    res.redirect('/debug');
  });
});

// API Routes
const apiRouter = express.Router();

// Middleware for API key authentication
apiRouter.use(authenticateApiKey);

// Endpoint to receive sensor data
apiRouter.post('/sensor-data', (req, res) => {
  const data = req.body;

  db.run(
    `INSERT INTO sensor_data (greenhouse_id, soil_moisture, water_level, ph_level, co2_level, nitrogen, phosphorus, potassium, light_intensity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.greenhouse_id,
      data.soil_moisture,
      data.water_level,
      data.ph_level,
      data.co2_level,
      data.nitrogen,
      data.phosphorus,
      data.potassium,
      data.light_intensity,
    ],
    function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ status: 'success' });
      }
    }
  );
});

// Endpoint for Raspberry Pi to get control commands
apiRouter.get('/greenhouse/:id/commands', (req, res) => {
  const greenhouseId = req.params.id;

  db.all(
    `SELECT * FROM control_commands WHERE greenhouse_id = ? AND executed = 0 ORDER BY timestamp ASC`,
    [greenhouseId],
    (err, commands) => {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ commands: commands });
      }
    }
  );
});

// Endpoint to acknowledge command execution
apiRouter.post('/greenhouse/:id/commands/:commandId/acknowledge', (req, res) => {
  const commandId = req.params.commandId;

  db.run(
    `UPDATE control_commands SET executed = 1 WHERE id = ?`,
    [commandId],
    function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ status: 'success' });
      }
    }
  );
});

// Endpoint to receive images from Raspberry Pi
apiRouter.post('/greenhouse/:id/image', async (req, res) => {
  const greenhouseId = req.params.id;
  const imageBase64 = req.body.image;

  // Decode the base64 image
  const imageBuffer = Buffer.from(imageBase64, 'base64');

  // Save the image to disk
  const imagePath = path.join(__dirname, 'public', 'uploads', `greenhouse_${greenhouseId}_${Date.now()}.jpg`);
  fs.writeFile(imagePath, imageBuffer, async (err) => {
    if (err) {
      console.error('Error saving image:', err);
      res.status(500).send('Error saving image.');
    } else {
      // Simulate analysis
      const lang = req.getLocale();
      const analysisText = lang === 'ar'
        ? 'تحليل الصورة: النبات يبدو صحيًا، لا توجد علامات على الأمراض.'
        : 'Image Analysis: The plant appears healthy with no signs of diseases.';

      // Optionally, you can store the analysis result in the database
      res.json({ status: 'success', analysis: analysisText });
    }
  });
});

app.use('/api', apiRouter);

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
