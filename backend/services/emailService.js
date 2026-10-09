const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

exports.sendVerificationEmail = async (to, link) => {
  await transporter.sendMail({
    to,
    subject: 'Verify your account',
    html: `Click <a href="${link}">here</a> to verify your email.`
  });
};
