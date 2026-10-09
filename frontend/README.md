# Egyptian History RAG Frontend

A React-based frontend application that interfaces with a Retrieval-Augmented Generation (RAG) system focused on Egyptian history. This application allows users to upload PDF documents about Egyptian history, index them, and ask questions to get accurate information extracted from the documents.

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Technologies Used](#technologies-used)
- [Installation](#installation)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [Backend Integration](#backend-integration)
- [License](#license)

## Features

- **Document Upload**: Upload PDF documents containing Egyptian history information
- **Document Indexing**: Process uploaded documents to make them searchable
- **Interactive Chat Interface**: Ask questions about Egyptian history and receive answers based on the indexed documents
- **Document Management**: View and manage indexed and unindexed documents
- **Real-time Indexing Status**: Monitor the progress of document indexing

## Screenshots

![Homepage](https://github.com/OmarOssama25/RAG_Frontend_EgyptianHistory/blob/main/Home_EgyptianHistory.png)
![Chat Interface](https://github.com/OmarOssama25/RAG_Frontend_EgyptianHistory/blob/main/Chat_EgyptianHistory.png)

## Technologies Used

- React.js
- Axios for API communication
- React Router for navigation
- Styled-components for styling

## Installation

To run this project locally, follow these steps:

1. Clone the repository:
```
 git clone https://github.com/OmarOssama25/RAG_Frontend_EgyptianHistory.git
cd RAG_Frontend_EgyptianHistory
```

2. Install dependencies:
```
npm install
```

3. Set up the backend:
- Make sure your RAG backend server is running
- By default, the frontend expects the backend to be running on http://localhost:3001
- If your backend uses a different URL, update the `API_URL` in `src/services/api.js`

4. Start the development server:
```
npm start
```
5. Open your browser and navigate to:
```
http://localhost:3000
```

## Usage

1. **Uploading Documents**:
- On the home page, use the document uploader to add PDF files about Egyptian history
- Click "Upload Document" to submit your file

2. **Indexing Documents**:
- After uploading, your document will appear in the "Uploaded Documents (Not Indexed)" section
- Click "Index Document" to process the document for searching
- Wait for the indexing process to complete

3. **Asking Questions**:
- Navigate to the Chat page
- Type your question about Egyptian history in the input field
- Press Enter or click "Send" to submit your question
- View the response generated from your indexed documents

## Project Structure
```
egypt-rag-frontend/
├── public/
├── src/
│ ├── components/
│ │ ├── ChatInterface.jsx
│ │ ├── DocumentUploader.jsx
│ │ ├── DocumentManager.jsx
│ │ └── ...
│ ├── services/
│ │ └── api.js
│ ├── pages/
│ │ ├── Home.jsx
│ │ └── Chat.jsx
│ ├── App.js
│ └── index.js
└── package.json
```

## Backend Integration

This frontend is designed to work with a Node.js/Python backend RAG system. The backend structure should include:

```
├── data/ # Uploaded PDF storage
├── vector_store/ # Saved vector embeddings
├── model_server.py # Flask model services
├── models/
│ ├── embedding.py # Embedding model wrapper
│ └── llm.py # Gemini 2.0 Flash interface
├── rag/
│ ├── classifier.py # Classify prompts either RAG related or Converstational
│ ├── indexer.py # PDF processing
│ ├── retriever.py # Semantic search
│ └── generator.py # Response generation
├── backend/
│ ├── server.js # Main API server
│ ├── routes/
│ │ └── api.js # API endpoints
│ ├── controllers/
│ │ └──ragController.js # Business logic
```

Make sure your backend is properly set up and running before using the frontend.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
