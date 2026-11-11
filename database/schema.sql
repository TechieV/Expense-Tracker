-- Smart Expense Tracker - MySQL schema (created automatically when the server starts)
CREATE TABLE IF NOT EXISTS users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  category_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  type ENUM('income','expense') NOT NULL,
  color VARCHAR(9) NOT NULL DEFAULT '#64748b',
  UNIQUE KEY uq_category (name, type)
);

CREATE TABLE IF NOT EXISTS statement_uploads (
  upload_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  file_name VARCHAR(200) NOT NULL,
  file_type VARCHAR(10) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'processing',
  rows_found INT NOT NULL DEFAULT 0,
  rows_imported INT NOT NULL DEFAULT 0,
  rows_duplicate INT NOT NULL DEFAULT 0,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transactions (
  txn_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  category_id INT NULL,
  upload_id INT NULL,
  `date` DATE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  type ENUM('income','expense') NOT NULL,
  is_anomaly TINYINT(1) NOT NULL DEFAULT 0,
  dedupe_key CHAR(40) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE SET NULL,
  FOREIGN KEY (upload_id) REFERENCES statement_uploads(upload_id) ON DELETE SET NULL,
  KEY idx_user_date (user_id, `date`),
  UNIQUE KEY uq_dedupe (user_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS budgets (
  budget_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  category_id INT NOT NULL,
  month CHAR(7) NOT NULL,
  limit_amount DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE CASCADE,
  UNIQUE KEY uq_budget (user_id, category_id, month)
);
