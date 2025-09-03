export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  preferences: {
    theme: 'light' | 'dark' | 'auto';
    model: string;
    maxTokens: number;
    temperature: number;
  };
  apiKey?: string;
  createdAt: Date;
  lastActive: Date;
}

export interface ProjectData {
  id: string;
  name: string;
  description: string;
  language: string;
  framework?: string;
  dependencies: string[];
  owner: string;
  collaborators: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationData {
  id: string;
  userId: string;
  projectId?: string;
  title: string;
  messageCount: number;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
  createdAt: Date;
  lastMessageAt: Date;
}

const NAMES = [
  'Alice Johnson', 'Bob Smith', 'Carol Davis', 'David Wilson', 'Eve Brown',
  'Frank Miller', 'Grace Lee', 'Henry Taylor', 'Ivy Chen', 'Jack Robinson'
];

const LANGUAGES = ['TypeScript', 'JavaScript', 'Python', 'Rust', 'Go', 'Java'];
const FRAMEWORKS = ['React', 'Next.js', 'Express', 'FastAPI', 'Gin', 'Spring'];
const ROLES = ['developer', 'senior-developer', 'architect', 'product-manager'];
const MODELS = ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'];

function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function generateUser(): UserProfile {
  const name = randomChoice(NAMES);
  const email = `${name.toLowerCase().replace(' ', '.')}@example.com`;
  const createdAt = randomDate(new Date(2023, 0, 1), new Date());
  const lastActive = randomDate(createdAt, new Date());

  return {
    id: generateId(),
    name,
    email,
    role: randomChoice(ROLES),
    preferences: {
      theme: randomChoice(['light', 'dark', 'auto'] as const),
      model: randomChoice(MODELS),
      maxTokens: randomChoice([1000, 2000, 4000, 8000]),
      temperature: Math.round((Math.random() * 2) * 100) / 100
    },
    createdAt,
    lastActive
  };
}

export function generateProject(ownerId?: string): ProjectData {
  const language = randomChoice(LANGUAGES);
  const framework = Math.random() > 0.3 ? randomChoice(FRAMEWORKS) : undefined;
  const createdAt = randomDate(new Date(2023, 0, 1), new Date());
  const updatedAt = randomDate(createdAt, new Date());

  const projectNames = [
    'awesome-app', 'todo-manager', 'data-processor', 'web-scraper',
    'api-gateway', 'chat-bot', 'analytics-dashboard', 'file-sync',
    'code-formatter', 'build-optimizer'
  ];

  return {
    id: generateId(),
    name: randomChoice(projectNames),
    description: `A ${language} project${framework ? ` using ${framework}` : ''}`,
    language,
    framework,
    dependencies: Array.from({ length: randomInt(3, 10) }, () => 
      `package-${Math.random().toString(36).substr(2, 8)}`
    ),
    owner: ownerId || generateId(),
    collaborators: Array.from({ length: randomInt(0, 3) }, () => generateId()),
    createdAt,
    updatedAt
  };
}

export function generateConversation(userId?: string, projectId?: string): ConversationData {
  const createdAt = randomDate(new Date(2023, 0, 1), new Date());
  const lastMessageAt = randomDate(createdAt, new Date());
  const messageCount = randomInt(1, 50);
  const inputTokens = messageCount * randomInt(50, 500);
  const outputTokens = messageCount * randomInt(100, 800);

  const conversationTitles = [
    'Help with TypeScript setup',
    'Debug async function',
    'Optimize database queries',
    'Add authentication',
    'Implement caching',
    'Fix build errors',
    'Code review assistance',
    'API integration help'
  ];

  return {
    id: generateId(),
    userId: userId || generateId(),
    projectId,
    title: randomChoice(conversationTitles),
    messageCount,
    tokenUsage: {
      input: inputTokens,
      output: outputTokens,
      total: inputTokens + outputTokens
    },
    createdAt,
    lastMessageAt
  };
}

export function generateUserDataset(userCount: number = 10) {
  const users = Array.from({ length: userCount }, () => generateUser());
  const projects = users.flatMap(user => 
    Array.from({ length: randomInt(1, 3) }, () => generateProject(user.id))
  );
  const conversations = users.flatMap(user => 
    Array.from({ length: randomInt(2, 8) }, () => {
      const userProjects = projects.filter(p => p.owner === user.id);
      const projectId = Math.random() > 0.5 && userProjects.length > 0 
        ? randomChoice(userProjects).id 
        : undefined;
      return generateConversation(user.id, projectId);
    })
  );

  return {
    users,
    projects,
    conversations,
    summary: {
      totalUsers: users.length,
      totalProjects: projects.length,
      totalConversations: conversations.length,
      totalTokens: conversations.reduce((sum, conv) => sum + conv.tokenUsage.total, 0)
    }
  };
}