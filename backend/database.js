const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Force a specific database name and location
const dbPath = path.join(__dirname, 'stockflow_new.db');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('✅ Connected to SQLite database at:', dbPath);
  }
});

db.serialize(() => {
  // Create users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email_notifications BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Users table error:', err);
    else console.log('✅ Users table ready');
  });

  // Create sectors table
  db.run(`
    CREATE TABLE IF NOT EXISTS sectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      icon TEXT DEFAULT '📦',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Sectors table error:', err);
    else console.log('✅ Sectors table ready');
  });

  // Create products table WITH description column
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT UNIQUE NOT NULL,
      description TEXT,
      sector_id INTEGER NOT NULL,
      price REAL NOT NULL,
      stock_quantity INTEGER NOT NULL,
      min_stock INTEGER NOT NULL DEFAULT 10,
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sector_id) REFERENCES sectors (id),
      FOREIGN KEY (created_by) REFERENCES users (id)
    )
  `, (err) => {
    if (err) console.error('Products table error:', err);
    else console.log('✅ Products table ready WITH description column');
  });

  // Create notifications table
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT 0,
      is_sent BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id),
      FOREIGN KEY (product_id) REFERENCES products (id)
    )
  `, (err) => {
    if (err) console.error('Notifications table error:', err);
    else console.log('✅ Notifications table ready');
  });

  // Create watchlist table
  db.run(`
    CREATE TABLE IF NOT EXISTS user_watchlist (
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, product_id),
      FOREIGN KEY (user_id) REFERENCES users (id),
      FOREIGN KEY (product_id) REFERENCES products (id)
    )
  `, (err) => {
    if (err) console.error('Watchlist table error:', err);
    else console.log('✅ Watchlist table ready');
  });

  // Insert predefined sectors
  const sectors = [
    { name: 'Electronics', description: 'Electronic devices and gadgets', icon: '📱' },
    { name: 'Clothing', description: 'Apparel and fashion items', icon: '👕' },
    { name: 'Food & Beverages', description: 'Food items and drinks', icon: '🍎' },
    { name: 'Home & Garden', description: 'Home improvement and garden supplies', icon: '🏠' },
    { name: 'Health & Beauty', description: 'Healthcare and cosmetic products', icon: '💄' },
    { name: 'Books & Media', description: 'Books, movies, and educational content', icon: '📚' },
    { name: 'Sports & Outdoors', description: 'Athletic and outdoor equipment', icon: '⚽' },
    { name: 'Automotive', description: 'Car parts and accessories', icon: '🚗' },
    { name: 'Toys & Games', description: 'Children toys and entertainment', icon: '🧸' },
    { name: 'Office Supplies', description: 'Business and office equipment', icon: '📎' }
  ];

  sectors.forEach((sector, index) => {
    setTimeout(() => {
      db.run('INSERT OR IGNORE INTO sectors (name, description, icon) VALUES (?, ?, ?)',
        [sector.name, sector.description, sector.icon], (err) => {
        if (err) console.error(`Error inserting sector ${sector.name}:`, err);
        else console.log(`✅ Sector added: ${sector.icon} ${sector.name}`);
      });
    }, index * 100); // Stagger inserts to avoid conflicts
  });

  console.log('🚀 Database initialization complete!');
});

module.exports = db;
