# Egyptian History RAG System with Gemini 3.8 Flash

A Retrieval-Augmented Generation (RAG) system for querying large Egyptian history PDF documents, powered by Gemini 3.8 for language generation and the Gemini embeddings API (`gemini-embedding-001`) for embeddings.

## Key Features

- **Gemini 3.8 Integration**: Uses Google's latest Gemini 3.8 Flash model for high-quality responses
- **Flask API**: Model services hosted locally for efficient reuse
- **Large PDF Handling**: Optimized for 1000+ page documents
- **Source Citation**: Provides references back to original document pages
- **Persistent Indexing**: Vector store maintains indexed documents between sessions
- **User Authentication**: Secure JWT-based authentication with email verification
- **Chat History Management**: Persistent conversation tracking with MongoDB

## System Architecture

```
    A[User Query] --> B[Flask API]
    B --> C[Retriever]
    C --> D[Vector Store]
    B --> E[Gemini 3.8 LLM]
    D --> E
    E --> F[Response with Sources]
```
The diagram shows:

1. **Flow Sequence**:
   - User submits query to Flask API
   - API routes request to Retriever
   - Retriever searches Vector Store
   - Results are passed to Gemini LLM
   - LLM combines context and knowledge
   - Final response with sources is returned

2. **Key Components**:
   - `Flask API`: Main request handler
   - `Retriever`: Semantic search component
   - `Vector Store`: Stored document embeddings
   - `Gemini 3.8 Flash LLM`: Response generator
   - `Response with Sources`: Final output with citations

## Prerequisites

- Python 3.8+
- Node.js 16+
- Google Cloud account (for the Gemini API — used for both LLM generation and embeddings, so network access is required)
- MongoDB 6.0+ (local installation or Atlas cloud)
- MongoDB Compass (GUI recommended)

## Installation

1. **Clone the repository**

    ```
    git clone https://github.com/mahmoudhaytham25/egyptian-tour-guide-rag.git
    cd egyptian-tour-guide-rag
    ```

2. **Install Python dependencies**

    ```
    cd model-server
    pip install -r requirements.txt
    ```

3. **Install Node.js dependencies**

    ```
    cd backend
    npm install
    ```

4. **Install MongoDB**
    - **Windows:** Download and install from [MongoDB Community Download](https://www.mongodb.com/try/download/community)
    - **Mac (Homebrew):**
        ```
        brew tap mongodb/brew
        brew install mongodb-community
        ```
    - **Ubuntu/Linux:**
        ```
        sudo apt-get install mongodb
        ```

5. **Start MongoDB**

    - **Windows:**  
      Open Command Prompt as Administrator and run:
      ```
      net start MongoDB
      ```
    - **Mac (Homebrew):**
      ```
      brew services start mongodb-community
      ```
    - **Linux:**
      ```
      sudo systemctl start mongod
      ```

6. **Connect to MongoDB (optional, for testing)**

    ```
    mongosh "mongodb://localhost:27017/egyptian_history_rag"
    ```

7. **Set up environment variables**

    The project uses **two separate `.env` files** — one per directory. Example files are provided: `backend/.env.example` and `model-server/.env.example`. Copy each one to `.env` in the same directory and fill in your values.

    Create `backend/.env` (consumed by `dotenv` in `backend/server.js`):

    ```
    PORT=3001
    MONGODB_URI=mongodb://localhost:27017/egyptian_history_rag
    JWT_SECRET=your_random_secure_jwt_secret
    MODEL_SERVER_URL=http://localhost:5050
    EMAIL_SERVICE=smtp.ethereal.email
    EMAIL_USER=your_email@example.com
    EMAIL_PASSWORD=your_email_password
    EMAIL_FROM=no-reply@egyptianhistory.com
    ```

    Create `model-server/.env` (consumed by `python-dotenv` via `rag/utils/env_loader.py`):

    ```
    GEMINI_API_KEY=your_gemini_api_key
    PORT=5050
    ```

8. **Verify MongoDB Connection**

    - You can use [MongoDB Compass](https://www.mongodb.com/products/compass) for a GUI.
    - Or test in the shell:
      ```
      mongosh "mongodb://localhost:27017/egyptian_history_rag"
      show dbs
      ```

## Running with Docker

The full stack (frontend, backend, model server, MongoDB) is defined in `docker-compose.yml` at the repo root:

1. **Create the root `.env` file** (compose reads it automatically):

    ```
    cp .env.example .env
    # edit .env — set GEMINI_API_KEY (required)
    ```

    | Variable | Required | Notes |
    |----------|----------|-------|
    | `GEMINI_API_KEY` | Yes | Used by the model server for Gemini 3.8 Flash and `gemini-embedding-001` embeddings (indexing and querying) |
    | `JWT_SECRET` | No | Backend JWT signing secret; falls back to `dev-only-secret-change-me` — always set a real value outside local dev |

2. **Build and start everything**:

    ```
    docker compose up --build
    ```

3. Open the frontend at `http://localhost:3000`. The backend API is at `http://localhost:3001`, the model server at `http://localhost:5050` (internal hostname `model-server`), and MongoDB at `mongodb://localhost:27017`.

### How indexing works under Docker

The backend **does not** run Python — it calls `POST http://model-server:5050/index` over HTTP, and the model server runs the indexer in-process. Uploads and the generated vector store are shared between the two containers via named volumes:

- `rag-data` — mounted at `/app/data` (model-server) and `/model-server/data` (backend, where its `../model-server/data` paths resolve). Seeded with the bundled `data/egyptian_history.pdf` on first run.
- `vector-store` — mounted at `/app/vector_store` (model-server) and `/model-server/vector_store` (backend). Holds generated `*_vectors.npz` / `*_metadata.json` files.
- `mongo-data` — MongoDB data files.

The same volume mounts keep `data/` and `vector_store/` consistent when running locally without Docker (both services then read the same repo directories).

### Docker caveats

- Embeddings run through the Gemini API (`gemini-embedding-001`) — there is no local model download, so the model-server image is small and first `up` is fast.
- The model server binds `0.0.0.0` only inside Docker (via the `HOST` env var); locally it still defaults to `127.0.0.1`.
- If `GEMINI_API_KEY` is missing the server starts but indexing, retrieval, and LLM generation all fail — it does not prompt for a key when running non-interactively.
- Vector files (`*_vectors.npz`) created by the old local embedding model are incompatible with `gemini-embedding-001` — re-index your PDFs after upgrading.

### Database migrations

The backend uses [migrate-mongo](https://github.com/seppevs/migrate-mongo) for MongoDB schema migrations. `backend/migrate-mongo-config.js` reads `MONGODB_URI` exactly like `config/database.js` (env first, `mongodb://localhost:27017/egyptian_history_rag` fallback, database name derived from the URI path), and migrations live in `backend/migrations/`.

Under Docker the backend's `docker-entrypoint.sh` waits for MongoDB to accept connections, runs `npx migrate-mongo up`, and only then starts `node server.js` — so `docker compose up` auto-migrates on every boot (pending migrations only; applied ones are tracked in the `changelog` collection). For local development, run them manually:

```bash
cd backend
npm run migrate:status              # list applied / pending migrations
npm run migrate:up                  # apply pending migrations
npm run migrate:down                # roll back the most recent migration
npm run migrate:create -- my-change # scaffold a new timestamped migration file
```

The initial migration (`migrations/…-initial-indexes.js`) only creates indexes implied by the Mongoose models: a unique `email_1` index on `users` (same name Mongoose auto-builds from `unique: true`, so it is a no-op where that index already exists — the migration codifies it explicitly), a compound `{ userId, isActive, updatedAt }` index on `conversations` matching the list query + sort in `chatController.getConversations`, and `{ conversationId, timestamp }` on `messages` matching the per-conversation message fetch + sort.

## Running the System

### Start the Flask Model Services (Port 5050)

1. **First Terminal**:
```
cd model-server
python model_server.py
```
This configures the Gemini API clients and starts the Flask API at `http://localhost:5050` (`/health`, `/query`, `/index`). Both the LLM and embeddings are remote — a valid `GEMINI_API_KEY` is required.

### Start the Node.js Server (Port 3001)

2. **Second Terminal**:
```
cd backend
npm start
```

The main API will be available at `http://localhost:3001`

## API Endpoints

### Authentication API

| Endpoint | Method | Description | Request Body |
|----------|--------|-------------|-------------|
| `/api/auth/signup` | POST | Register a new user | `{"email": "user@example.com", "password": "SecurePassword123"}` |
| `/api/auth/verify/{token}` | GET | Verify user email address | N/A |
| `/api/auth/login` | POST | Login with credentials | `{"email": "user@example.com", "password": "SecurePassword123"}` |

### Chat/Conversation API

| Endpoint | Method | Description | Request Body |
|----------|--------|-------------|-------------|
| `/api/chat/conversations` | POST | Create new conversation | `{"title": "Egyptian Pyramids", "message": "Tell me about the Great Pyramid of Giza"}` |
| `/api/chat/conversations` | GET | List all user conversations | N/A |
| `/api/chat/conversations/{id}` | GET | Get specific conversation with messages | N/A |
| `/api/chat/conversations/{id}/messages` | POST | Add message to conversation | `{"role": "user", "content": "Tell me more about Giza"}` |
| `/api/chat/conversations/{id}/permanent` | DELETE | Delete conversation permanently | N/A |

### RAG System API

All endpoints below except `/api/health` require `Authorization: Bearer <token>`.

| Endpoint | Method | Description | Request Body |
|----------|--------|-------------|-------------|
| `/api/upload` | POST | Upload a PDF document | Form data with `pdf` file |
| `/api/index` | POST | Index the uploaded document | `{"filename": "egyptian_history.pdf"}` |
| `/api/status` | GET | Check indexing status | N/A |
| `/api/query` | POST | Submit a query | `{"query": "What do you know about Alexandria?", "conversationId": "id"}` |

### Model Services API (Flask)

| Endpoint | Method | Description | Request Body |
|----------|--------|-------------|-------------|
| `/health` | GET | Model load status | N/A |
| `/query` | POST | Run a query through the RAG pipeline | `{"query": "your question", "top_k": 5, "chat_history": []}` |
| `/index` | POST | Index a PDF from `data/` (runs `PDFIndexer` in-process) | `{"filename": "egyptian_history.pdf"}` |

The backend calls `/index` over HTTP — indexing no longer spawns a Python child process, which is what allows the backend and model server to run in separate containers.

## Authentication Details

The system uses JWT (JSON Web Tokens) for authentication:

- **Token Format**: Bearer token in Authorization header
- **Token Lifespan**: 7 days by default (configurable in `.env`)
- **Email Verification**: Required before login is permitted
- **Password Requirements**: Minimum 8 characters with numbers and letters

Example authentication header:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Usage Examples

### Authentication Flow

1. **Register a new user**:
```
curl -X POST -H "Content-Type: application/json" -d '{"email": "user@example.com", "password": "SecurePassword123"}' http://localhost:3001/api/auth/signup
```

2. **Verify email** (link sent to user's email):
```
# User clicks verification link or you can test with:
curl -X GET http://localhost:3001/api/auth/verify/{verification_token}
```

3. **Login to get JWT token**:
```
curl -X POST -H "Content-Type: application/json" -d '{"email": "user@example.com", "password": "SecurePassword123"}' http://localhost:3001/api/auth/login
```

### RAG System Usage

1. **Upload your Egyptian history PDF**:
```
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -F "pdf=@path/to/document.pdf" http://localhost:3001/api/upload
```

2. **Index the document**:
```
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer YOUR_TOKEN" -d '{"filename": "egyptian_history.pdf"}' http://localhost:3001/api/index
```

3. **Query the system**:
```
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer YOUR_TOKEN" -d '{"query":"Who built the Great Pyramid of Giza?"}' http://localhost:3001/api/query
```

### Chat System Usage

1. **Create a new conversation**:
```
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer YOUR_TOKEN" -d '{"title": "Egyptian Pyramids", "message": "Tell me about the Great Pyramid of Giza"}' http://localhost:3001/api/chat/conversations
```

2. **Get all conversations**:
```
curl -X GET -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3001/api/chat/conversations
```

3. **Add message to conversation**:
```
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer YOUR_TOKEN" -d '{"role": "user", "content": "Tell me more about hieroglyphics"}' http://localhost:3001/api/chat/conversations/{conversation_id}/messages
```

### Example Interactions

#### Scheduling Example

**Request:**
```json
{
  "query": "I want a schedule for a Thursday in Luxor",
  "conversationId": "682c6daec6b3bd05f48c01e3"
}
```

**Response:**
```json
{
  "answer": "Alright, explorers! Get ready for an unforgettable Thursday in Luxor! Here's a packed itinerary to make the most of your day among the pharaohs:\n\n**Thursday Luxor Monument Tour Schedule**\n\n*   **8:00 AM - 8:30 AM:** Start your day with a hearty breakfast at your hotel or a local cafe. Fuel up for a day of exploration!\n\n*   **8:30 AM - 9:00 AM:** Travel to **Karnak Temple**. It's best to arrive early to beat the crowds and the heat.\n\n*   **9:00 AM - 11:30 AM:** Immerse yourselves in the grandeur of **Karnak Temple**. This is the largest religious structure ever built! Wander through the colossal columns of the Great Hypostyle Hall, marvel at the sacred lake, and discover the stories etched in the ancient stones. (Allow 2.5 hours)\n\n*   **11:30 AM - 12:00 PM:** Take a leisurely stroll or a short taxi ride along the Corniche to **Luxor Temple**. Enjoy the views of the Nile as you go!\n\n*   **12:00 PM - 1:30 PM:** **Lunch Break**. Find a restaurant near Luxor Temple and enjoy a delicious Egyptian meal. Try some *kushari* or *ful medames* for an authentic experience!\n\n*   **1:30 PM - 3:00 PM:** Explore **Luxor Temple**. This temple is beautifully preserved and offers a fascinating glimpse into ancient Egyptian rituals. Don't miss the Avenue of Sphinxes connecting it to Karnak Temple. (Allow 1.5 hours)\n\n*   **3:00 PM - 3:30 PM:** Travel to the West Bank by taxi and ferry to **Deir al-Bahari (Temple of Hatshepsut)**.\n\n*   **3:30 PM - 5:00 PM:** Visit **Deir al-Bahari (Temple of Hatshepsut)**. This mortuary temple is dedicated to the female pharaoh Hatshepsut. Admire its unique architectural design, blending seamlessly with the surrounding cliffs. (Allow 1.5 hours)\n\n*   **5:00 PM - 5:30 PM:** Travel back to the East Bank.\n\n*   **5:30 PM - 6:",
  "sources": [],
  "enhanced_query": null,
  "original_query": null
}
```

#### Conversational Example

**Request:**
```json
{
  "query": "Hello how are you my name is omar",
  "conversationId": "682c6daec6b3bd05f48c01e3"
}
```

**Response:**
```json
{
  "answer": "Ahlan wa sahlan, Omar! I'm doing well, thank you for asking! It's a pleasure to meet you. What can I help you with today? Perhaps you have some questions about the glorious history of Egypt? I'm ready when you are!\n",
  "sources": [],
  "enhanced_query": null,
  "original_query": null
}
```

#### Conversation History Examples

**First Query:**
```json
{
  "query": "Who built the Great Pyramid of Giza?",
  "conversationId": "682c95e92808a47dc799310c"
}
```

**Response:**
```json
{
  "answer": "Okay, I can certainly tell you who built the Great Pyramid of Giza!\n\nBased on the documents you've provided, the Great Pyramid of Giza was built for **King Khufu (also referred to as Khofo)**, a pharaoh of the 4th Dynasty (c. 2589–2566 BC) (Document 1, Page 41; Document 4, Pages 366). It was intended to be his royal tomb (Document 4, Page 366). The construction of the Great Pyramid is considered one of the greatest engineering achievements in history and took approximately 20 years to complete (Document 4, Page 366).\n\nIt's interesting to note that the Giza pyramid complex, also called the Giza Necropolis, includes the Great Pyramid, the Pyramid of Khafre, and the Pyramid of Menkaure, along with the Great Sphinx (Document 2, Page 142). Khafre was Khufu's son, and Menkaure was his grandson (Document 1, Page 41). All these structures were built during the Fourth Dynasty of the Old Kingdom of ancient Egypt, between approximately 2600 and 2500 BC (Document 2, Page 142).\n\nAlso, just to clarify, while there's mention of a \"Pharaoh's pyramid\" being the largest in Giza (Document 5, Page 366), this seems to be a general reference to Khufu's Great Pyramid, which is indeed the largest.\n",
  "sources": [
    {
      "page": 41,
      "text": "\nthe world, and indeed already were even in Roman times. Each of these spectacular structures\nserved..."
    },
    {
      "page": 142,
      "text": "s around the world. The Cairo Geniza, as it is\nknown today, includes many rare and previously unknow..."
    },
    {
      "page": 349,
      "text": "t the largest pyramid, the greatest building in the history of\n"
    },
    {
      "page": 366,
      "text": "major focus of their economic and religious life.\nParagraph 1282\nThe Great Pyramid was built by Phar..."
    },
    {
      "page": 366,
      "text": "id built for Pharaoh Smurfro, one of the most important Egyptian pyramids.\nParagraph 1285\nThe Zuser ..."
    }
  ],
  "enhanced_query": null,
  "original_query": null
}
```

**Follow-up Query:**
```json
{
  "query": "When did he rule Egypt?",
  "conversationId": "682c95e92808a47dc799310c"
}
```

**Response:**
```json
{
  "answer": "Okay, I can definitely tell you when King Khufu, the pharaoh who built the Great Pyramid of Giza, ruled Egypt!\n\nBased on the documents, King Khufu (also referred to as Khofo) ruled Egypt approximately from **2589–2566 BC** (Document 1, Page 41). He was a pharaoh of the 4th Dynasty (Document 1, Page 41). It's worth noting that the Giza pyramid complex, including the pyramids of Khafre (Khufu's son) and Menkaure (Khufu's grandson), were all built during the Fourth Dynasty of the Old Kingdom, between approximately 2600 and 2500 BC (Document 2, Page 142).\n",
  "sources": [
    {
      "page": 41,
      "text": "\nthe world, and indeed already were even in Roman times. Each of these spectacular structures\nserved..."
    },
    {
      "page": 142,
      "text": "s around the world. The Cairo Geniza, as it is\nknown today, includes many rare and previously unknow..."
    },
    {
      "page": 366,
      "text": "major focus of their economic and religious life.\nParagraph 1282\nThe Great Pyramid was built by Phar..."
    },
    {
      "page": 350,
      "text": "ancient Egyptian civilization.\nParagraph 1192\nKing Khofu is the pharaoh whose largest pyramid was bu..."
    },
    {
      "page": 147,
      "text": "discovery.\nParagraph 451\nThe pyramids of Giza and others are thought to have been constructed to hou..."
    }
  ],
  "enhanced_query": "When did King Khufu, the pharaoh who built the Great Pyramid of Giza, rule Egypt?",
  "original_query": "When did he rule Egypt?"
}
```

**Second Follow-up Query:**
```json
{
  "query": "How tall was it when initially built?",
  "conversationId": "682c95e92808a47dc799310c"
}
```

**Response:**
```json
{
  "answer": "Okay, I can certainly help you with information about the height of the Great Pyramid of Giza!\n\nUnfortunately, none of the provided documents in the current context explicitly state the exact initial height of the Great Pyramid of Giza. While Document 3 mentions the height of a \"particle pyramid\" as being about 136.4 meters, it also clarifies that this is the *second* largest pyramid in Giza, after the \"Khvo pyramid\" (which I believe is a typo and meant to refer to Khufu's pyramid). So, this doesn't give us the specific height we're looking for.\n\nHowever, based on our previous conversation, we know that the Great Pyramid of Giza was built for King Khufu (c. 2589–2566 BC) during the 4th Dynasty (Document 1, Page 41). It is also considered the oldest and largest of the three pyramids at Giza (Document 1, Page 41).\n\nWhile I can't give you the exact height based on these documents, it's safe to say it was taller than 136.4 meters, which is the height of the second largest pyramid mentioned in Document 3. To get the precise original height, we'd need a document that explicitly states that measurement.\n",
  "sources": [
    {
      "page": 41,
      "text": "\nthe world, and indeed already were even in Roman times. Each of these spectacular structures\nserved..."
    },
    {
      "page": 349,
      "text": "t the largest pyramid, the greatest building in the history of\n"
    },
    {
      "page": 760,
      "text": "ge and rehabilitation needs.\nParagraph 3584\nThe particle pyramid is the second largest pyramid in th..."
    },
    {
      "page": 254,
      "text": "ort 25 km Hurghada.\nParagraph 804\nPyramids: there are more than 70 pyramids along the Nile, with the..."
    },
    {
      "page": 391,
      "text": "The Great Pyramids of Giza were built during the fourth family period, and the Khufu pyramid\nbegan t..."
    }
  ],
  "enhanced_query": "How tall was the Great Pyramid of Giza when it was initially built?",
  "original_query": "How tall was it when initially built?"
}
```

## Configuration Options

Modify `config.json` to adjust system behavior:
```
{
  "chunk_size": 500,
  "chunk_overlap": 100,
  "top_k": 5,
  "temperature": 0.7,
  "embedding_batch_size": 32,
  "max_tokens": 1024,
  "jwt_expiration": "7d",
  "verification_expiry": "24h"
}
```

## Troubleshooting

**Common Issues**:

1. **Gemini API Errors**:
   - Verify your Google Cloud API key has Gemini enabled
   - Check quota limits in Google Cloud Console

2. **Indexing Fails on Large PDFs**:
   - Reduce `chunk_size` in config.json
   - Increase `embedding_batch_size`

3. **Port Conflicts**:
   - Change `PORT` in `model-server/.env` (Flask, default 5050) or `backend/.env` (Express, default 3001) if occupied. If you change the Flask port, update `MODEL_SERVER_URL` in `backend/.env` to match.

4. **Embedding API Errors / Rate Limits**:
   - The indexer retries failed embedding requests a few times with backoff, but large PDFs can still hit Gemini rate limits — wait and retry indexing
   - Verify `GEMINI_API_KEY` is set and has quota in Google AI Studio

5. **Authentication Issues**:
   - Check that JWT_SECRET is properly set in .env
   - Verify email verification process is working
   - Ensure token is being passed correctly in Authorization header

## Project Structure
```
egyptian-tour-guide-rag/
├── backend/                           # Express API (Node.js)
│   ├── config/
│   │   └── database.js                # MongoDB connection setup
│   ├── controllers/
│   │   ├── authController.js          # Signup, login, verification
│   │   ├── chatController.js          # Chat history logic
│   │   └── ragController.js           # RAG business logic (PDF, query, index)
│   ├── middleware/
│   │   └── auth.js                    # JWT authentication middleware
│   ├── models/
│   │   ├── user.js                    # User schema
│   │   ├── conversation.js            # Conversation schema
│   │   └── message.js                 # Message schema
│   ├── routes/
│   │   ├── api.js                     # RAG endpoints (upload, index, query)
│   │   ├── auth.js                    # Auth endpoints (signup, login)
│   │   └── chat.js                    # Chat endpoints (conversations, messages)
│   ├── services/
│   │   └── emailService.js            # Email utility (Ethereal/dev or real SMTP)
│   ├── migrations/                    # migrate-mongo database migrations
│   ├── migrate-mongo-config.js        # migrate-mongo config (reads MONGODB_URI)
│   ├── docker-entrypoint.sh           # Waits for MongoDB, runs migrations, starts app
│   ├── server.js                      # Main Express app entry point
│   └── package.json                   # Node.js dependencies & scripts
│
├── model-server/                      # Python model services + RAG pipeline
│   ├── model_server.py                # Flask app for Gemini 3.8 & embeddings
│   ├── models/
│   │   ├── embedding.py               # Embedding model wrapper
│   │   ├── llm.py                     # Gemini 3.8 Flash interface
│   │   └── reranker.py                # Result reranking
│   ├── rag/
│   │   ├── classifier.py              # Prompt type classification
│   │   ├── indexer.py                 # PDF chunking/indexing
│   │   ├── retriever.py               # Semantic search
│   │   ├── generator.py               # Response generation
│   │   └── utils/                     # Path/env/file helpers
│   ├── data/                          # Uploaded PDF storage
│   ├── times_places/                  # Monument dataset (trip scheduling)
│   ├── vector_store/                  # Saved vector embeddings (gitignored)
│   └── requirements.txt               # Python dependencies
│
├── frontend/                          # React SPA
├── screenshots/
└── docs/                              # This file
```

## License

MIT License - See [LICENSE](../LICENSE) for details.


