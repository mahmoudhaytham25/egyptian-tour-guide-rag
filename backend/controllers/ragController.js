const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios'); // New import for HTTP requests

const Message = require('../models/message');
const Conversation = require('../models/conversation');

// Flask model server URL
const MODEL_SERVER_URL = process.env.MODEL_SERVER_URL || 'http://localhost:5050';

// Track indexing status
let indexingStatus = {
  isIndexing: false,
  progress: 0,
  error: null,
  message: null,
  lastIndexed: null,
  currentFile: null
};

exports.uploadPdf = (req, res) => {
  try {
    console.log("Upload request received");
    console.log("File details:", req.file);
    
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    
    console.log("File successfully saved to:", req.file.path);
    
    // Check if there's existing metadata for this file and remove it
    // to ensure it shows up as unindexed
    const baseFileName = req.file.filename.replace('.pdf', '');
    const metadataPath = path.join(__dirname, '../../model-server/vector_store', `${baseFileName}_metadata.json`);
    
    if (fs.existsSync(metadataPath)) {
      try {
        fs.unlinkSync(metadataPath);
        console.log(`Deleted existing metadata file for ${baseFileName} to mark as unindexed`);
      } catch (err) {
        console.warn(`Warning: Could not delete metadata file ${metadataPath}:`, err.message);
      }
    }
    
    res.status(200).json({ 
      success: true, 
      message: 'File uploaded successfully and ready for indexing', 
      filename: req.file.filename,
      path: req.file.path,
      requiresIndexing: true
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ success: false, message: 'Error uploading file', error: error.message });
  }
};

// Index the document
exports.indexDocument = (req, res) => {
  try {
    if (indexingStatus.isIndexing) {
      return res.status(409).json({ 
        success: false, 
        message: 'Indexing already in progress', 
        progress: indexingStatus.progress 
      });
    }

    // Get filename from request body instead of hardcoding
    const { filename } = req.body;
    
    // Validate that filename was provided
    if (!filename) {
      return res.status(400).json({
        success: false,
        message: 'Filename is required'
      });
    }
    
    const pdfPath = path.join(__dirname, '../../model-server/data', filename);
    
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ 
        success: false, 
        message: `PDF file ${filename} not found. Please upload the file first.` 
      });
    }

    // Update indexing status with current file info
    indexingStatus = {
      isIndexing: true,
      progress: 0,
      error: null,
      message: null,
      lastIndexed: null,
      currentFile: filename
    };

    console.log(`Starting indexing process for ${filename}`);

    // Run the Python indexer script
    const pythonProcess = spawn('python', [
      path.join(__dirname, '../../model-server/rag/indexer.py'),
      pdfPath
    ]);

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      console.log('Indexer output:', output);
      
      // Try to parse progress updates
      try {
        if (output.includes('progress:')) {
          const progressMatch = output.match(/progress: (\d+)/);
          if (progressMatch && progressMatch[1]) {
            indexingStatus.progress = parseInt(progressMatch[1]);
          }
        } else if (output.includes('completed')) {
          // This is a completion message
          indexingStatus.message = output;
        }
      } catch (e) {
        console.error('Error parsing progress:', e);
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.log(`Indexer stderr output: ${output}`);
      
      // Determine if this is an actual error or just an info message
      if (output.includes('ERROR') || output.includes('Error:')) {
        indexingStatus.error = output;
      } else if (output.includes('completed') || output.includes('INFO')) {
        // This is likely an info message printed to stderr
        indexingStatus.message = output;
      }
    });

    pythonProcess.on('close', (code) => {
      console.log(`Indexing process for ${filename} exited with code ${code}`);
      
      if (code === 0) {
        indexingStatus.progress = 100;
        indexingStatus.lastIndexed = new Date().toISOString();
        
        // REMOVE THIS BLOCK - DO NOT CREATE METADATA FILE HERE
        // The Python indexer script should create the proper metadata file with chunks
        
        // Set success message
        if (!indexingStatus.message) {
          indexingStatus.message = `Indexing of ${filename} completed successfully`;
        }
        
        // Clear any error that might have been set incorrectly
        if (indexingStatus.error && indexingStatus.error.includes('INFO') && indexingStatus.error.includes('completed')) {
          const message = indexingStatus.error;
          indexingStatus.error = null;
          indexingStatus.message = message;
        }
      } else {
        if (!indexingStatus.error) {
          indexingStatus.error = `Process exited with code ${code}`;
        }
      }
      
      // Mark indexing as complete regardless of outcome
      indexingStatus.isIndexing = false;
    });

    res.status(202).json({ 
      success: true, 
      message: `Indexing started for ${filename}`, 
      status: indexingStatus 
    });
  } catch (error) {
    console.error('Error starting indexing process:', error);
    indexingStatus.isIndexing = false;
    indexingStatus.error = error.message;
    res.status(500).json({ 
      success: false, 
      message: 'Error starting indexing process', 
      error: error.message 
    });
  }
};


// Check indexing status
exports.getIndexingStatus = (req, res) => {
  res.status(200).json({ 
    success: true,
    status: indexingStatus
  });
};

// Query the RAG system using the Flask model server
exports.queryRag = async (req, res) => {
  try {
    const queryText = req.body.question || req.body.query;
    const conversationId = req.body.conversationId;

    console.log(`RAG query received: "${queryText}"`);

    if (!queryText) {
      return res.status(400).json({
        success: false,
        message: 'Question is required'
      });
    }

    let chatHistory = [];
    if (conversationId) {
      try {
        const messages = await Message.find({ conversationId })
          .sort({ timestamp: -1 })
          .limit(10);

        chatHistory = messages.reverse().map(msg => ({
          role: msg.role,
          content: msg.content
        }));

        console.log(`Retrieved ${chatHistory.length} messages from history`);
      } catch (error) {
        console.error('Error fetching chat history:', error);
      }
    }

    try {
      console.log(`Sending query to model server: ${MODEL_SERVER_URL}/query`);
      const modelResponse = await axios.post(`${MODEL_SERVER_URL}/query`, {
        query: queryText,
        top_k: 5,
        chat_history: chatHistory
      });

      console.log('Model server response received');
      const rawData = modelResponse.data;
      console.log('Full model response:', JSON.stringify(rawData, null, 2));

      let plainTextAnswer = '';
      let sources = [];
      let enhancedQuery = null;
      let originalQuery = null;

      if (rawData && rawData.response && typeof rawData.response === 'object') {
        const response = rawData.response;

        if (typeof response.answer === 'string') {
          plainTextAnswer = response.answer;
        } else {
          plainTextAnswer = JSON.stringify(response.answer, null, 2);
        }

        sources = response.sources || [];
        enhancedQuery = response.enhanced_query || null;
        originalQuery = response.original_query || null;
      } else {
        plainTextAnswer = "I'm sorry, I couldn't generate a proper response. Please try again.";
        console.log('Unexpected response structure:', JSON.stringify(rawData));
      }

      console.log('Plain text answer:', plainTextAnswer);

      if (conversationId) {
        try {
          const conversation = await Conversation.findById(conversationId);
          if (!conversation) {
            console.warn(`Conversation ${conversationId} not found, cannot save messages`);
          } else {
            const existingUserMessage = await Message.findOne({
              conversationId,
              role: 'user',
              content: queryText
            }).sort({ timestamp: -1 });

            if (!existingUserMessage) {
              await Message.create({
                conversationId,
                role: 'user',
                content: queryText
              });
            }

            console.log('Skipping saving duplicate user message in /query');


            const lastAssistantMessage = await Message.findOne({
              conversationId,
              role: 'assistant',
              content: plainTextAnswer
            }).sort({ timestamp: -1 });

            if (!lastAssistantMessage) {
              await Message.create({
                conversationId,
                role: 'assistant',
                content: plainTextAnswer,
                metadata: {
                  sources: sources,
                  enhanced_query: enhancedQuery,
                  original_query: originalQuery
                }
              });
            } else {
              console.log('Skipping duplicate assistant message save');
            }

            conversation.updatedAt = Date.now();
            await conversation.save();

            console.log(`Saved query and response to conversation ${conversationId}`);
          }
        } catch (error) {
          console.error('Error saving to conversation history:', error);
        }
      }

      const isJsonFormat = req.query.format === 'json' || req.body.format === 'json';
      if (isJsonFormat || !req.query.format) {
        return res.status(200).json({
          answer: plainTextAnswer,
          sources: sources,
          enhanced_query: enhancedQuery,
          original_query: originalQuery
        });
      } else {
        res.setHeader('Content-Type', 'text/plain');
        return res.status(200).send(String(plainTextAnswer));
      }

    } catch (error) {
      console.error('Error calling model server:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Error generating response from model server',
        error: error.message
      });
    }

  } catch (error) {
    console.error('Error in queryRag function:', error);
    return res.status(500).json({
      success: false,
      message: 'Error processing your question',
      error: error.message
    });
  }
};

// Get indexing status
exports.getStatus = (req, res) => {
  // Create a clean copy of the status for the response
  const statusResponse = {
    isIndexing: indexingStatus.isIndexing,
    progress: indexingStatus.progress,
    message: indexingStatus.message,
    error: indexingStatus.error,
    lastIndexed: indexingStatus.lastIndexed
  };
  
  res.status(200).json({
    success: true,
    status: statusResponse
  });
};

exports.getDocuments = (req, res) => {
  try {
    const dataDir = path.join(__dirname, '../../model-server/data');
    const vectorStoreDir = path.join(__dirname, '../../model-server/vector_store');
    
    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      console.log('Data directory does not exist');
      return res.status(200).json({ documents: [] });
    }
    
    // Get all PDF files from data directory
    const pdfFiles = fs.readdirSync(dataDir)
      .filter(file => file.toLowerCase().endsWith('.pdf'));
    console.log("PDF files found in data directory:", pdfFiles);
    
    // Create a set of indexed document names (without extension)
    const indexedDocsSet = new Set();
    
    // Check if vector store directory exists before trying to read it
    if (fs.existsSync(vectorStoreDir)) {
      // Look specifically for metadata files with the exact naming pattern
      const metadataFiles = fs.readdirSync(vectorStoreDir)
        .filter(file => file.endsWith('_metadata.json'));
      
      metadataFiles.forEach(file => {
        const docName = file.replace('_metadata.json', '');
        indexedDocsSet.add(docName.toLowerCase());
      });
      
      console.log("Indexed documents set:", Array.from(indexedDocsSet));
    } else {
      console.log("Vector store directory does not exist yet - no indexed documents");
    }
    
    // Map PDF files to document objects
    const documents = pdfFiles.map(file => {
      const fileName = file.replace('.pdf', '');
      const fullPath = path.join(dataDir, file);
      const stats = fs.statSync(fullPath);
      
      // Check if document is indexed - use strict check with exact pattern matching
      const isIndexed = indexedDocsSet.has(fileName.toLowerCase());
      
      return {
        id: fileName,
        filename: file,
        originalName: file,
        path: fullPath,
        uploadDate: stats.mtime,
        indexed: isIndexed, // This will now be false for new uploads
        size: stats.size,
      };
    });
    
    console.log("Found documents:", documents);
    
    res.status(200).json({ documents });
  } catch (error) {
    console.error('Error getting documents:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve documents',
      details: error.message 
    });
  }
};