# @think-grid-labs/react-starter-auth

<div align="center">
  <img src="https://raw.githubusercontent.com/ThinkGrid-Labs/react-starter-auth/main/react-starter-auth.png" alt="React Starter Authentication" width="600" />
  <p>A lightweight, type-safe, and robust authentication suite for React and Next.js.</p>
</div>

---

### 🚀 Features
- **Type-Safe**: Built with TypeScript, supporting generic User objects for better developer experience.
- **Next.js & React Ready**: Optimized for both client-side and server-side contexts.
- **JWT Centric**: Seamless handling of JWT tokens with automatic expiry checks.
- **Secure by Default**: Strict cookie settings and secure state persistence.
- **Fetcher Integration**: Auto-injects `Authorization` headers into your API requests.
- **Route Protection**: Higher-Order Components and Wrapper components for private routes.

---

### 📦 Installation

```bash
# Using pnpm
pnpm add @think-grid-labs/react-starter-auth

# Using npm
npm install @think-grid-labs/react-starter-auth

# Using yarn
yarn add @think-grid-labs/react-starter-auth
```

---

### 🛠️ Setup

Wrap your application in the `AuthProvider`:

```tsx
import { AuthProvider } from '@think-grid-labs/react-starter-auth';

function App({ children }) {
  return (
    <AuthProvider>
      {children}
    </AuthProvider>
  );
}
```

---

### 🔑 Authentication Flow

#### Sign In
```tsx
import { useAuth } from '@think-grid-labs/react-starter-auth';

const { signIn } = useAuth();

const handleLogin = async () => {
  const { token, user } = await api.login(credentials);
  
  signIn({ 
    token, 
    user: { 
      id: user.id, 
      name: user.display_name,
      role: 'admin'
    } 
  });
};
```

#### Get User (State)
```tsx
import { useAuth } from '@think-grid-labs/react-starter-auth';

// Define your own User interface for full type safety
interface UserProfile {
  id: string;
  name: string;
  role: string;
}

const { user, isAuthenticated, isLoading } = useAuth<UserProfile>();

console.log(user?.role); // Fully typed!
```

---

### 📡 Data Fetching

The `fetcher` utility automatically appends the `Authorization: Bearer <token>` header to your requests if a valid token exists.

```tsx
import { fetcher } from '@think-grid-labs/react-starter-auth';

const getProfile = async () => {
  const response = await fetcher('https://api.example.com/me');
  const data = await response.json();
  return data;
};
```

---

### 🛡️ Route Protection

#### Using `ProtectedRoute`
```tsx
import { ProtectedRoute } from '@think-grid-labs/react-starter-auth';
import Dashboard from './Dashboard';

// Automatically redirects to /login if not authenticated
<ProtectedRoute component={Dashboard} redirectPath="/login" />
```

#### Using `withAuthentication` (HOC)
```tsx
import { withAuthentication } from '@think-grid-labs/react-starter-auth';

const PrivatePage = () => <div>Private Content</div>;

export default withAuthentication(PrivatePage);
```

---

### 📄 License
MIT © [ThinkGrid-Labs](https://github.com/ThinkGrid-Labs)


