const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const {
  updateSkills,
  reuploadResume,
  updateSkillsCron,
  reuploadResumeCron,
} = require("./utils");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

updateSkillsCron();
reuploadResumeCron();

app.get('/naukari/stats', (req, res) => {
  res.status(200).json({ status: 'Server is running', uptime: process.uptime() });
});

app.get('/naukari/update-skills', async (req, res, next) => {
  try {
    const result = await updateSkills();
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ status: 'failed', message: error.message });
  }
});

app.get('/naukari/reupload-resume', async (req, res, next) => {
  try {
    const result = await reuploadResume();
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ status: 'failed', message: error.message });
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});


