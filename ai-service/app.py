"""
AI service for the Smart Expense Tracker.

Categorizes bank/UPI transaction descriptions with a TF-IDF (character n-grams) + Logistic Regression model.
The model is trained on a built-in list of common Indian merchants AND on the user's own previously labelled
transactions (sent by the Node server), so it adapts to each user's habits.
"""
import os
import re
from flask import Flask, jsonify, request
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline

app = Flask(__name__)

SEED_EXPENSE = {
    "Food": ["swiggy", "zomato", "dominos pizza", "mcdonalds", "kfc", "starbucks coffee", "cafe coffee day", "bigbasket groceries", "blinkit", "zepto", "restaurant dinner", "chai tapri", "haldirams", "burger king", "subway", "pizza hut", "dmart supermarket", "reliance fresh", "bakery", "biryani house", "dhaba", "ice cream parlour", "juice center", "grocery store", "vegetables fruits", "swiggy instamart", "faasos", "canteen lunch", "tea stall", "food court"],
    "Travel": ["uber trip", "ola cabs", "rapido bike", "irctc train ticket", "indigo airlines", "makemytrip", "redbus ticket", "delhi metro card recharge", "petrol pump", "indian oil fuel", "hp petrol", "fastag recharge", "goibibo", "air india", "auto rickshaw", "cleartrip flight", "bpcl fuel", "shell fuel", "parking fee", "toll plaza", "railway booking", "cab ride"],
    "Shopping": ["amazon", "flipkart", "myntra", "ajio", "nykaa", "meesho", "decathlon sports", "croma electronics", "reliance digital", "zara", "h&m", "lifestyle store", "shoppers stop", "westside", "pantaloons", "ikea", "tata cliq", "snapdeal", "lenskart", "bata shoes", "apple store", "vijay sales", "amazon pay purchase", "flipkart order"],
    "Bills": ["electricity bill", "bses rajdhani", "tata power", "airtel postpaid", "jio recharge", "vodafone idea", "bsnl broadband", "water bill", "indane gas cylinder", "mahanagar gas", "house rent", "rent payment", "insurance premium", "lic premium", "act fibernet", "dth recharge", "tata play", "society maintenance", "emi payment", "loan emi", "credit card bill payment", "wifi broadband", "mobile recharge"],
    "Entertainment": ["netflix", "amazon prime video", "spotify", "hotstar", "disney plus", "bookmyshow", "pvr cinemas", "inox movies", "youtube premium", "steam games", "playstation store", "gaming", "concert tickets", "zee5", "sonyliv", "gaana", "jiosaavn", "bowling", "amusement park", "club entry", "movie tickets"],
    "Health": ["apollo pharmacy", "medplus", "1mg", "pharmeasy", "hospital", "clinic consultation", "dr lal pathlabs", "gym membership", "cult fit", "netmeds", "dental clinic", "diagnostic lab", "eye checkup", "practo", "fortis hospital", "medical store", "doctor fees"],
    "Education": ["udemy course", "coursera", "college fee", "tuition fees", "byjus", "unacademy", "books stationery", "amazon kindle", "exam fee", "upgrad", "coding ninjas", "library fee", "stationery shop", "physics wallah", "school fees", "online course"],
}
SEED_INCOME = {
    "Salary": ["salary credit", "payroll", "monthly salary", "stipend", "wages", "neft salary", "salary for the month", "company salary"],
    "Other Income": ["interest credit", "refund", "cashback", "dividend", "upi received", "gift received", "freelance payment", "reimbursement", "sent by friend", "money received"],
}
FALLBACK = {"expense": "Other", "income": "Other Income"}
THRESHOLD = 0.45  # below this confidence we say "Other" instead of guessing


def clean(text: str) -> str:
    text = text.lower()
    text = re.sub(r"\d{4,}", " ", text)          # long reference numbers
    text = re.sub(r"[^a-z0-9&+ ]+", " ", text)   # UPI/, @bank, punctuation
    return re.sub(r"\s+", " ", text).strip()


def build_docs(seed: dict):
    docs, labels = [], []
    for cat, phrases in seed.items():
        for p in phrases:
            for variant in (p, f"upi {p}", f"pos {p} mumbai", f"{p} payment ref"):
                docs.append(clean(variant))
                labels.append(cat)
    return docs, labels


def train(seed: dict, extra):
    docs, labels = build_docs(seed)
    for d, c in extra:
        if c in seed and d and d.strip():
            for _ in range(3):  # user's own labels count more than the generic list
                docs.append(clean(d))
                labels.append(c)
    model = make_pipeline(
        TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), sublinear_tf=True),
        LogisticRegression(max_iter=1000, C=8.0),
    )
    model.fit(docs, labels)
    return model


@app.get("/health")
def health():
    return jsonify(ok=True)


@app.post("/categorize")
def categorize():
    data = request.get_json(silent=True) or {}
    items = data.get("items", [])
    examples = [(e.get("description", ""), e.get("category", "")) for e in data.get("examples", [])][:300]
    models = {"expense": train(SEED_EXPENSE, examples), "income": train(SEED_INCOME, examples)}
    out = []
    for it in items:
        kind = "income" if it.get("type") == "income" else "expense"
        text = clean(str(it.get("description", "")))
        if not text:
            out.append({"category": FALLBACK[kind], "confidence": 0.0})
            continue
        proba = models[kind].predict_proba([text])[0]
        i = int(proba.argmax())
        conf = float(proba[i])
        cat = str(models[kind].classes_[i]) if conf >= THRESHOLD else FALLBACK[kind]
        out.append({"category": cat, "confidence": round(conf, 3)})
    return jsonify(predictions=out)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("AI_PORT", "8000")))
