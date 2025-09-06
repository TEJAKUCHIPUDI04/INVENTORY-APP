const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const db = require('./database');

const app = express();
const PORT = 3001;
const JWT_SECRET = 'stockflow-secret-key';

// Email configuration (configure with your email service)
const emailTransporter = nodemailer.createTransport({
  service: 'gmail', // or your email service
  auth: {
    user: 'your-email@gmail.com', // Replace with your email
    pass: 'your-app-password' // Replace with your app password
  }
});

app.use(cors());
app.use(express.json());

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Invalid token' });
    req.user = decoded;
    next();
  });
};

// 🔐 AUTH ROUTES
app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body;
  const hashedPassword = bcrypt.hashSync(password, 10);
  
  db.run('INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
    [username, email, hashedPassword], function(err) {
    if (err) return res.status(400).json({ error: 'Username or email already exists' });
    res.json({ message: 'User registered successfully', userId: this.lastID });
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ userId: user.id, username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ 
      token, 
      user: { id: user.id, username: user.username, email: user.email }
    });
  });
});

// 📂 SECTORS ROUTES
app.get('/api/sectors', (req, res) => {
  db.all('SELECT * FROM sectors ORDER BY name', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 📦 FIXED PRODUCT ROUTES WITH PROPER SKU VALIDATION
app.get('/api/products', verifyToken, (req, res) => {
  const query = `
    SELECT p.*, s.name as sector_name, s.icon as sector_icon, u.username as created_by_name
    FROM products p
    JOIN sectors s ON p.sector_id = s.id
    LEFT JOIN users u ON p.created_by = u.id
    ORDER BY p.created_at DESC
  `;
  
  db.all(query, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// FIXED: Add Product with Proper SKU Validation
app.post('/api/products', verifyToken, (req, res) => {
  const { name, sku, description, sector_id, price, stock_quantity, min_stock } = req.body;
  
  // Normalize SKU (trim whitespace and make uppercase)
  const normalizedSKU = sku.trim().toUpperCase();
  
  console.log('Checking SKU:', normalizedSKU); // Debug log
  
  // Check if SKU already exists (case-insensitive)
  db.get('SELECT id FROM products WHERE UPPER(TRIM(sku)) = ?', [normalizedSKU], (err, row) => {
    if (err) {
      console.error('SKU check error:', err);
      return res.status(500).json({ error: err.message });
    }
    
    if (row) {
      console.log('SKU already exists:', row);
      return res.status(400).json({ error: 'Product SKU already exists' });
    }
    
    console.log('SKU is unique, inserting product...');
    
    // Insert with normalized SKU
    db.run('INSERT INTO products (name, sku, description, sector_id, price, stock_quantity, min_stock, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, normalizedSKU, description, sector_id, price, stock_quantity, min_stock, req.user.userId], function(err) {
      if (err) {
        console.error('Insert error:', err);
        return res.status(400).json({ error: err.message });
      }
      
      console.log('Product inserted successfully with ID:', this.lastID);
      
      // Check if stock is already low and create notification
      if (stock_quantity <= min_stock) {
        checkAndCreateLowStockNotification(this.lastID);
      }
      
      res.json({ message: 'Product added successfully', id: this.lastID });
    });
  });
});

// FIXED: Update Product with Proper SKU Validation
app.put('/api/products/:id', verifyToken, (req, res) => {
  const { name, sku, description, sector_id, price, stock_quantity, min_stock } = req.body;
  const { id } = req.params;
  
  // Normalize SKU
  const normalizedSKU = sku.trim().toUpperCase();
  
  console.log('Updating product ID:', id, 'with SKU:', normalizedSKU);
  
  // Check if SKU exists in other products (excluding current product)
  db.get('SELECT id FROM products WHERE UPPER(TRIM(sku)) = ? AND id != ?', [normalizedSKU, id], (err, row) => {
    if (err) {
      console.error('SKU update check error:', err);
      return res.status(500).json({ error: err.message });
    }
    
    if (row) {
      console.log('SKU already exists in another product:', row);
      return res.status(400).json({ error: 'Product SKU already exists' });
    }
    
    // Update with normalized SKU
    db.run('UPDATE products SET name=?, sku=?, description=?, sector_id=?, price=?, stock_quantity=?, min_stock=? WHERE id=?',
      [name, normalizedSKU, description, sector_id, price, stock_quantity, min_stock, id], function(err) {
      if (err) {
        console.error('Update error:', err);
        return res.status(400).json({ error: err.message });
      }
      if (this.changes === 0) return res.status(404).json({ error: 'Product not found' });
      
      console.log('Product updated successfully');
      
      // Check for low stock after update
      if (stock_quantity <= min_stock) {
        checkAndCreateLowStockNotification(id);
      }
      
      res.json({ message: 'Product updated successfully' });
    });
  });
});

app.delete('/api/products/:id', verifyToken, (req, res) => {
  db.run('DELETE FROM products WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Product not found' });
    
    // Delete related notifications
    db.run('DELETE FROM notifications WHERE product_id = ?', [req.params.id]);
    
    res.json({ message: 'Product deleted successfully' });
  });
});

app.get('/api/products/low-stock', verifyToken, (req, res) => {
  const query = `
    SELECT p.*, s.name as sector_name, s.icon as sector_icon
    FROM products p
    JOIN sectors s ON p.sector_id = s.id
    WHERE p.stock_quantity <= p.min_stock
    ORDER BY p.stock_quantity ASC
  `;
  
  db.all(query, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 📊 ENHANCED DASHBOARD STATS
app.get('/api/stats', verifyToken, (req, res) => {
  const queries = [
    'SELECT COUNT(*) as total FROM products',
    'SELECT COUNT(*) as lowStock FROM products WHERE stock_quantity <= min_stock',
    'SELECT SUM(stock_quantity * price) as totalValue FROM products',
    'SELECT COUNT(*) as unreadNotifications FROM notifications WHERE user_id = ? AND is_read = 0'
  ];

  Promise.all([
    new Promise((resolve, reject) => {
      db.get(queries[0], (err, row) => err ? reject(err) : resolve(row));
    }),
    new Promise((resolve, reject) => {
      db.get(queries[1], (err, row) => err ? reject(err) : resolve(row));
    }),
    new Promise((resolve, reject) => {
      db.get(queries[2], (err, row) => err ? reject(err) : resolve(row));
    }),
    new Promise((resolve, reject) => {
      db.get(queries[3], [req.user.userId], (err, row) => err ? reject(err) : resolve(row));
    })
  ]).then(results => {
    res.json({
      totalProducts: results[0].total,
      lowStockItems: results[1].lowStock,
      totalValue: results[2].totalValue || 0,
      unreadNotifications: results[3].unreadNotifications
    });
  }).catch(err => {
    res.status(500).json({ error: err.message });
  });
});

// 🚨 LOW STOCK NOTIFICATION FUNCTIONS
function checkAndCreateLowStockNotification(productId) {
  // Get product details
  db.get('SELECT * FROM products WHERE id = ?', [productId], (err, product) => {
    if (err || !product) return;

    if (product.stock_quantity <= product.min_stock) {
      // Get users who should be notified (product creator + watchlist users)
      const getUsersQuery = `
        SELECT DISTINCT u.id, u.email, u.username, u.email_notifications
        FROM users u
        WHERE u.id = ?
        UNION
        SELECT DISTINCT u.id, u.email, u.username, u.email_notifications
        FROM users u
        JOIN user_watchlist w ON u.id = w.user_id
        WHERE w.product_id = ?
      `;

      db.all(getUsersQuery, [product.created_by, productId], (err, users) => {
        if (err || !users.length) return;

        users.forEach(user => {
          // Check if notification already exists for this user and product
          db.get('SELECT id FROM notifications WHERE user_id = ? AND product_id = ? AND type = "low_stock" AND is_read = 0',
            [user.id, productId], (err, existingNotification) => {
            
            if (!existingNotification) {
              // Create new notification
              const title = `Low Stock Alert: ${product.name}`;
              const message = `Product "${product.name}" (${product.sku}) is running low. Current stock: ${product.stock_quantity}, Minimum: ${product.min_stock}`;
              
              db.run('INSERT INTO notifications (user_id, product_id, type, title, message) VALUES (?, ?, ?, ?, ?)',
                [user.id, productId, 'low_stock', title, message], function(err) {
                
                if (!err && user.email_notifications) {
                  // Send email notification
                  sendEmailNotification(user.email, title, message, product);
                }
              });
            }
          });
        });
      });
    }
  });
}

function sendEmailNotification(email, title, message, product) {
  const mailOptions = {
    from: 'your-email@gmail.com', // Replace with your email
    to: email,
    subject: title,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center;">
          <h1>📦 StockFlow Alert</h1>
        </div>
        <div style="padding: 20px; background: #f8f9fa;">
          <h2 style="color: #ef4444;">${title}</h2>
          <p>${message}</p>
          <div style="background: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <strong>Product Details:</strong><br>
            Name: ${product.name}<br>
            SKU: ${product.sku}<br>
            Current Stock: ${product.stock_quantity}<br>
            Minimum Stock: ${product.min_stock}
          </div>
          <p>Please restock this item to avoid stockouts.</p>
        </div>
        <div style="background: #333; color: white; padding: 10px; text-align: center; font-size: 12px;">
          StockFlow Inventory Management System
        </div>
      </div>
    `
  };

  emailTransporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log('Email send error:', error);
    } else {
      console.log('Email sent:', info.response);
      // Mark notification as sent
      db.run('UPDATE notifications SET is_sent = 1 WHERE user_id IN (SELECT id FROM users WHERE email = ?) AND product_id = ? AND type = "low_stock"',
        [email, product.id]);
    }
  });
}

// Add a debug route to check existing SKUs
app.get('/api/debug/skus', verifyToken, (req, res) => {
  db.all('SELECT id, name, sku, UPPER(TRIM(sku)) as normalized_sku FROM products ORDER BY id', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Start server
app.listen(PORT, () => {
  console.log('\n🌟 ===============================================');
  console.log('🚀 ENHANCED STOCKFLOW SERVER STARTED!');
  console.log(`🌐 Server: http://localhost:${PORT}`);
  console.log('✨ Features: Sectors, Notifications, Email Alerts');
  console.log('🔧 Debug: Check /api/debug/skus for existing SKUs');
  console.log('===============================================\n');
});
