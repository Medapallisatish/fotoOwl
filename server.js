const express = require("express");
const app = express();
const sqlite3 = require("sqlite3");
const path = require("path");
const { open } = require("sqlite");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const dbPath = path.join(__dirname, "library.db");
let db = null;

const initializeDataServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server is running successfully at http://localhost:3000");
    });
  } catch (e) {
    console.log(`Error occurred: ${e.message}`);
  }
};

initializeDataServer();

app.use(express.json());

const SECRET_KEY = "library_secret_key"; // Secret key for signing JWT tokens

// Middleware to authenticate JWT
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (authHeader) {
    const token = authHeader.split(" ")[1];
    jwt.verify(token, SECRET_KEY, (err, user) => {
      if (err) {
        return res.status(403).send("Invalid or expired token");
      }
      req.user = user;
      next();
    });
  } else {
    res.status(401).send("Authorization token missing");
  }
};

// API to Register a New User
app.post("/register", async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return res.status(400).send("Invalid request. Email, password, and role are required.");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const insertUserQuery = `
      INSERT INTO usertable (email, password, role)
      VALUES ('${email}', '${hashedPassword}', '${role}');
    `;
    await db.run(insertUserQuery);
    res.send("User registered successfully");
  } catch (e) {
    res.status(500).send(`Error registering user: ${e.message}`);
  }
});

// API to Login and Generate JWT
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).send("Invalid request. Email and password are required.");
    }

    const getUserQuery = `
      SELECT * FROM usertable WHERE email = '${email}';
    `;
    const dbUser = await db.get(getUserQuery);

    if (!dbUser) {
      return res.status(400).send("Invalid email");
    }

    const isPasswordValid = await bcrypt.compare(password, dbUser.password);
    if (!isPasswordValid) {
      return res.status(400).send("Invalid password");
    }

    const payload = { userId: dbUser.id, role: dbUser.role };
    const token = jwt.sign(payload, SECRET_KEY, { expiresIn: "1h" });
    res.send({ token });
  } catch (e) {
    res.status(500).send(`Error logging in: ${e.message}`);
  }
});

// API to Get List of Books (Library User)
app.get("/books", authenticateJWT, async (req, res) => {
  try {
    const getBooksQuery = `
      SELECT * FROM bookstable;
    `;
    const books = await db.all(getBooksQuery);
    res.send(books);
  } catch (e) {
    res.status(500).send(`Error fetching books: ${e.message}`);
  }
});

// API to Submit a Request to Borrow a Book
app.post("/borrow-book", authenticateJWT, async (req, res) => {
  try {
    const { userId } = req.user; // Extract userId from JWT
    const { bookId, date1, date2 } = req.body;

    if (!bookId || !date1 || !date2) {
      return res.status(400).send("Invalid request. Book ID, date1, and date2 are required.");
    }

    const checkBookQuery = `SELECT * FROM bookstable WHERE id = ${bookId};`;
    const bookExists = await db.get(checkBookQuery);

    if (!bookExists) {
      return res.status(400).send("Invalid book ID.");
    }

    const overlappingQuery = `
      SELECT * FROM borrowrequests 
      WHERE book_id = ${bookId} 
        AND (
          (date1 <= '${date2}' AND date2 >= '${date1}')
        )
        AND status = 'approved';
    `;
    const overlaps = await db.get(overlappingQuery);

    if (overlaps) {
      return res.status(400).send("The book is already borrowed during the selected dates.");
    }

    const submitRequestQuery = `
      INSERT INTO borrowrequests (user_id, book_id, date1, date2, status)
      VALUES (${userId}, ${bookId}, '${date1}', '${date2}', 'pending');
    `;
    await db.run(submitRequestQuery);
    res.send("Borrow request submitted successfully");
  } catch (e) {
    res.status(500).send(`Error submitting borrow request: ${e.message}`);
  }
});

// API to Approve or Deny a Borrow Request (Librarian)
app.put("/approve-request/:requestId", authenticateJWT, async (req, res) => {
  try {
    const { role } = req.user;
    const { requestId } = req.params;
    const { status } = req.body;

    if (role !== "librarian") {
      return res.status(403).send("Only librarians can approve or deny requests.");
    }

    if (status !== "approved" && status !== "denied") {
      return res.status(400).send("Invalid status. Use 'approved' or 'denied'.");
    }

    const updateRequestQuery = `
      UPDATE borrowrequests
      SET status = '${status}'
      WHERE id = ${requestId};
    `;
    await db.run(updateRequestQuery);
    res.send(`Request ${status} successfully`);
  } catch (e) {
    res.status(500).send(`Error updating request: ${e.message}`);
  }
});

// API to View Borrow History for a User
app.get("/user-history/:userId", authenticateJWT, async (req, res) => {
  try {
    const { role } = req.user;
    const { userId } = req.params;

    if (role !== "librarian") {
      return res.status(403).send("Only librarians can view user history.");
    }

    const checkUserQuery = `SELECT * FROM usertable WHERE id = ${userId};`;
    const userExists = await db.get(checkUserQuery);

    if (!userExists) {
      return res.status(400).send("Invalid user ID.");
    }

    const getUserHistoryQuery = `
      SELECT * FROM borrowrequests
      WHERE user_id = ${userId};
    `;
    const history = await db.all(getUserHistoryQuery);
    res.send(history);
  } catch (e) {
    res.status(500).send(`Error fetching user history: ${e.message}`);
  }
});
