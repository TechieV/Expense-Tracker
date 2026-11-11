# AI-Powered Smart Expense Tracker

A full-stack personal finance app. Add income and expenses manually, or **upload a bank statement (CSV / PDF)** and let the system extract, de-duplicate and **auto-categorize** every transaction. A dashboard shows balance, spending by category, monthly trends, budgets, and smart insights.

| Layer | Technology |
|---|---|
| Frontend | React 18 (Vite), React Router, Recharts, plain CSS |
| Backend | Node.js, Express, JWT auth, bcrypt, multer, csv-parse, pdf-parse |
| Database | **MongoDB** via Mongoose (collections and indexes are created automatically) |
| AI service | Python, Flask, scikit-learn (TF-IDF + Logistic Regression) |

```
expense-tracker/
├── client/        React frontend
├── server/        Express REST API (auth, transactions, budgets, statements, insights)
├── ai-service/    Python categorization service
└── samples/       sample_statement.csv / .pdf (synthetic data for testing the importer)
```

## 1. Prerequisites
- **Node.js 18+** (https://nodejs.org)
- **MongoDB** - either MongoDB Community Server installed locally (https://www.mongodb.com/try/download/community), or a free MongoDB Atlas cluster (cloud)
- **Python 3.10+** (only for the AI service; the app still works without it, using keyword rules)

## 2. One-time setup
```bash
# 1) make sure MongoDB is running (nothing to create: the database, collections and indexes appear on first start)
#    Windows: the MongoDB service starts automatically after install. Check with MongoDB Compass (optional GUI).

# 2) install Node packages for server and client
npm run install:all

# 3) configure the server
cd server
copy .env.example .env        # Windows   (Mac/Linux: cp .env.example .env)
#   then open .env: set a long random JWT_SECRET. MONGODB_URI already points to local MongoDB;
#   for Atlas paste your connection string there instead.

# 4) install the AI service packages
cd ../ai-service
pip install -r requirements.txt
```

## 3. Run it (development)
Open **three terminals**:
```bash
# Terminal 1 - AI service (port 8000)
cd ai-service && python app.py

# Terminal 2 - API (port 5000)
cd server && npm run dev

# Terminal 3 - React app (port 5173)
cd client && npm run dev
```
Open **http://localhost:5173**.

### Or run as a single server (production style)
```bash
npm run build      # builds the React app into client/dist
npm start          # Express serves API + app on http://localhost:5000
```

## 4. Demo data (great for presenting)
```bash
cd server && npm run seed
```
Creates **demo@example.com / Demo@1234** with ~3 months of realistic transactions, budgets, and one deliberately large purchase that gets flagged as unusual. Then try **Import Statement** with `samples/sample_statement.csv` and `samples/sample_statement.pdf`.

## 5. Database design (MongoDB collections)
| Collection | Main fields |
|---|---|
| `users` | name, email (unique), passwordHash, createdAt |
| `categories` | name, type (income/expense), color (10 defaults are seeded automatically) |
| `transactions` | userId, categoryId, uploadId, date (`YYYY-MM-DD`), month (`YYYY-MM`), amount, description, type, isAnomaly, dedupeKey |
| `budgets` | userId, categoryId, month, limitAmount |
| `statementuploads` | userId, fileName, fileType, status, rowsFound, rowsImported, rowsDuplicate |

Key indexes: `transactions` has a **unique index on (userId, dedupeKey)**, which is what stops a statement from being imported twice, and an index on (userId, date). `budgets` has a unique index on (userId, categoryId, month). The dashboard uses MongoDB **aggregation pipelines** (`$match` + `$group`) for totals, category split and the 6-month series.

## 6. What is implemented
- Register / login (bcrypt-hashed passwords, JWT sessions, rate-limited auth routes, helmet headers)
- Add / edit / delete transactions with filters, search and pagination
- **AI categorization**: Python model trained on common Indian merchants *plus the user's own labelled history*; falls back to keyword rules automatically if the AI service is offline
- **Statement import**: CSV (flexible header detection, Dr/Cr or debit/credit columns) and text-based PDF (rebuilds table rows, infers income/expense from the running balance); re-uploading the same file never creates duplicates
- **Unusual transaction detection**: robust z-score (median + MAD) within each category; recurring bills such as rent are not flagged
- Monthly budgets with progress bars and over-budget alerts
- Dashboard: income, expenses, savings, balance, category donut, 6-month chart, insights
- Insights (data-driven): biggest category, month-over-month changes, budget warnings, savings rate, projected month-end spend, unusual transactions

## 7. Known limitations (be upfront about these in your viva)
- **Scanned (image) PDFs are not supported yet** - OCR is listed as future work. The importer says so clearly.
- PDF parsing works on text-based statements with a Date / Narration / Amount / Balance layout; unusual bank layouts may need parser tweaks.
- Insights are rule/statistics based, not generated by a language model. Predictions improve as more history is added.
- Categories are a fixed list (Food, Travel, Shopping, Bills, Entertainment, Health, Education, Other, Salary, Other Income).
- Single-currency (INR).

## 8. API overview (all except auth need `Authorization: Bearer <token>`)
| Method | Endpoint | Purpose |
|---|---|---|
| POST | /api/auth/register, /api/auth/login | Create account / log in |
| GET | /api/auth/me | Current user |
| GET/POST | /api/transactions | List (filters: month, type, categoryId, q, page) / add |
| PUT/DELETE | /api/transactions/:id | Edit / delete |
| POST | /api/statements | Upload CSV/PDF (multipart field `file`) |
| GET | /api/statements | Recent imports |
| GET | /api/dashboard/summary?month=YYYY-MM | Totals, category split, 6-month series, budgets |
| GET/POST/DELETE | /api/budgets | Monthly category budgets |
| GET | /api/insights?month=YYYY-MM | Smart insights |
| GET | /api/categories | Category list |