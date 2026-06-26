const express = require('express');
const path = require('path');
const StocktakeManager = require('./lib/stocktake-manager');
const StocktakeCreator = require('./stocktake-creator');

const app = express();
const stocktakeManager = new StocktakeManager();
const stocktakeCreator = new StocktakeCreator();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Initialize data directory
stocktakeManager.initialize();

// API Routes

// Get all stocktakes
app.get('/api/stocktakes', async (req, res) => {
  try {
    const stocktakes = await stocktakeManager.listStocktakes();
    res.json(stocktakes);
  } catch (error) {
    console.error('Error getting stocktakes:', error);
    res.status(500).json({ error: 'Failed to get stocktakes' });
  }
});

// Get specific stocktake
app.get('/api/stocktake/:id', async (req, res) => {
  try {
    const stocktake = await stocktakeManager.loadStocktake(req.params.id);
    res.json(stocktake);
  } catch (error) {
    console.error('Error getting stocktake:', error);
    res.status(500).json({ error: 'Failed to get stocktake' });
  }
});

// Start stocktake creation with progress tracking
app.post('/api/start-stocktake-creation', async (req, res) => {
  try {
    const { name, notes } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Stocktake name is required' });
    }

    console.log(`Starting stocktake creation: ${name}`);

    const result = await stocktakeCreator.startCreation(name, {
      notes: notes || ''
    });

    res.json(result);
  } catch (error) {
    console.error('Error starting stocktake creation:', error);
    res.status(500).json({ error: 'Failed to start creation: ' + error.message });
  }
});

// Get stocktake creation progress
app.get('/api/stocktake-progress/:creationId', async (req, res) => {
  try {
    const progress = await stocktakeCreator.getProgress(req.params.creationId);
    if (!progress) {
      return res.status(404).json({ error: 'Progress not found' });
    }
    res.json(progress);
  } catch (error) {
    console.error('Error getting progress:', error);
    res.status(500).json({ error: 'Failed to get progress' });
  }
});

// Create new stocktake (original method)
app.post('/api/create-stocktake', async (req, res) => {
  try {
    const { name, notes } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Stocktake name is required' });
    }

    console.log(`Creating stocktake: ${name}`);

    const stocktake = await stocktakeManager.createStocktake(name, {
      notes: notes || ''
    });

    res.json(stocktake);
  } catch (error) {
    console.error('Error creating stocktake:', error);
    res.status(500).json({ error: 'Failed to create stocktake: ' + error.message });
  }
});

// Update counted quantity
app.post('/api/update-quantity', async (req, res) => {
  try {
    const { stocktakeId, itemId, locationId, countedQuantity } = req.body;

    await stocktakeManager.updateCountedQuantity(stocktakeId, itemId, locationId, countedQuantity);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating quantity:', error);
    res.status(500).json({ error: 'Failed to update quantity' });
  }
});

// Update serial number status
app.post('/api/update-serial', async (req, res) => {
  try {
    const { stocktakeId, itemId, locationId, serialId, found } = req.body;

    await stocktakeManager.updateSerialNumber(stocktakeId, itemId, locationId, serialId, found);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating serial:', error);
    res.status(500).json({ error: 'Failed to update serial status' });
  }
});

// Add additional serial number
app.post('/api/add-serial', async (req, res) => {
  try {
    const { stocktakeId, itemId, locationId, serialNumber } = req.body;

    await stocktakeManager.addAdditionalSerial(stocktakeId, itemId, locationId, serialNumber);
    res.json({ success: true });
  } catch (error) {
    console.error('Error adding serial:', error);
    res.status(500).json({ error: 'Failed to add serial number' });
  }
});

// Complete stocktake
app.post('/api/complete-stocktake', async (req, res) => {
  try {
    const { stocktakeId } = req.body;

    const stocktake = await stocktakeManager.completeStocktake(stocktakeId);
    res.json(stocktake);
  } catch (error) {
    console.error('Error completing stocktake:', error);
    res.status(500).json({ error: 'Failed to complete stocktake: ' + error.message });
  }
});

// Delete stocktake
app.delete('/api/stocktake/:id', async (req, res) => {
  try {
    await stocktakeManager.deleteStocktake(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting stocktake:', error);
    res.status(500).json({ error: 'Failed to delete stocktake: ' + error.message });
  }
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Halo Stocktake System running on http://localhost:${PORT}`);
  console.log(`📁 Data directory: ${path.join(__dirname, 'data')}`);
  console.log(`🔧 Ready to create and manage stocktakes!`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

module.exports = app;