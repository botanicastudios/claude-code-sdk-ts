import fs from 'fs';
import crypto from 'crypto';

function generateRandomString(length) {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

function generateEmail() {
  const domains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'company.com'];
  const username = generateRandomString(8);
  const domain = domains[Math.floor(Math.random() * domains.length)];
  return `${username}@${domain}`;
}

function generatePhoneNumber() {
  const areaCodes = ['555', '123', '456', '789', '012'];
  const areaCode = areaCodes[Math.floor(Math.random() * areaCodes.length)];
  const number = Math.floor(Math.random() * 9000000) + 1000000;
  return `(${areaCode}) ${number.toString().slice(0, 3)}-${number.toString().slice(3)}`;
}

function generateUser() {
  const firstNames = ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Emily', 'Robert', 'Lisa', 'James', 'Maria'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
  
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  
  return {
    id: crypto.randomUUID(),
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    email: generateEmail(),
    phone: generatePhoneNumber(),
    age: Math.floor(Math.random() * 50) + 18,
    createdAt: new Date().toISOString(),
    isActive: Math.random() > 0.2
  };
}

function generateUsers(count = 100) {
  const users = [];
  for (let i = 0; i < count; i++) {
    users.push(generateUser());
  }
  return users;
}

const userCount = process.argv[2] ? parseInt(process.argv[2]) : 100;
const users = generateUsers(userCount);

console.log(`Generated ${users.length} users`);
console.log('Sample user:', JSON.stringify(users[0], null, 2));

fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
console.log('User data saved to users.json');