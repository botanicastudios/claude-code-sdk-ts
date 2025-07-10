interface User {
  id: string;
  name: string;
  email: string;
  age: number;
  city: string;
  country: string;
  profession: string;
  joinDate: string;
  isActive: boolean;
}

const firstNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack', 'Kate', 'Liam', 'Mia', 'Noah', 'Olivia', 'Peter', 'Quinn', 'Ruby', 'Sam', 'Tina'];
const lastNames = ['Anderson', 'Brown', 'Clark', 'Davis', 'Evans', 'Fisher', 'Garcia', 'Harris', 'Johnson', 'King', 'Lee', 'Martinez', 'Nelson', 'O\'Connor', 'Parker', 'Quinn', 'Rodriguez', 'Smith', 'Taylor', 'Wilson'];
const cities = ['New York', 'London', 'Tokyo', 'Paris', 'Sydney', 'Toronto', 'Berlin', 'Mumbai', 'São Paulo', 'Amsterdam', 'Stockholm', 'Copenhagen', 'Vienna', 'Dublin', 'Barcelona', 'Rome', 'Prague', 'Warsaw', 'Budapest', 'Helsinki'];
const countries = ['USA', 'UK', 'Japan', 'France', 'Australia', 'Canada', 'Germany', 'India', 'Brazil', 'Netherlands', 'Sweden', 'Denmark', 'Austria', 'Ireland', 'Spain', 'Italy', 'Czech Republic', 'Poland', 'Hungary', 'Finland'];
const professions = ['Software Engineer', 'Data Scientist', 'Product Manager', 'Designer', 'Marketing Manager', 'Sales Representative', 'Teacher', 'Doctor', 'Lawyer', 'Accountant', 'Consultant', 'Architect', 'Writer', 'Photographer', 'Chef', 'Nurse', 'Analyst', 'Developer', 'Researcher', 'Entrepreneur'];

function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(start: Date, end: Date): string {
  const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  return date.toISOString().split('T')[0];
}

function generateUser(id: number): User {
  const firstName = randomChoice(firstNames);
  const lastName = randomChoice(lastNames);
  const cityIndex = randomInt(0, cities.length - 1);
  
  return {
    id: `user_${id.toString().padStart(4, '0')}`,
    name: `${firstName} ${lastName}`,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
    age: randomInt(18, 65),
    city: cities[cityIndex],
    country: countries[cityIndex],
    profession: randomChoice(professions),
    joinDate: randomDate(new Date(2020, 0, 1), new Date()),
    isActive: Math.random() > 0.1
  };
}

export function generateUserData(count: number = 100): User[] {
  return Array.from({ length: count }, (_, i) => generateUser(i + 1));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const userCount = process.argv[2] ? parseInt(process.argv[2]) : 100;
  const users = generateUserData(userCount);
  console.log(JSON.stringify(users, null, 2));
}