<div align="center">
        <a href="#" title="React Starter Authentication">
            <img src="https://github.com/akosidencio/react-starter-auth/blob/main/react-starter-auth.png" alt="React Starter Authentication" />
        </a>
</div>


### Features

Authentication library built for react token based authentication with JWT
- Lightweight and easy to use
- Built for React JS
- Works with Next js
- JWT based authentication
- Secure client authentication

### Installation
```jsx
  npm install @think-grid-labs/react-starter-auth
  
  yarn @think-grid-labs/react-starter-auth
```

### Setup

```jsx
import { AuthProvider } from '@think-grid-labs/react-starter-auth';

<AuthProvider>
  <App>
</AuthProvider>

```
### Signin

```jsx
import { useAuth } from '@think-grid-labs/react-starter-auth'

const { signIn } = useAuth()

const access_token = 'jsjdjdjsxxfd' // response from api
const user {
    name: 'john doe',
    email: 'example@example.com',
    phone: '',
    role: ''
}

const authuser = {
  token: access_token,
  user: user
}
signIn(authuser)

```

### User 

```jsx
import { useAuth } from '@think-grid-labs/react-starter-auth'

// You can pass a custom User type for better type safety
interface MyUser {
  name: string;
  email: string;
}

const { isAuthenticated, user } = useAuth<MyUser>()
```

### Fetcher

fetcher extends the native Web fetch() API to update each request on the server to set headers Authorizaton Bearer upon sign in.

```jsx
import { fetcher } from '@think-grid-labs/react-starter-auth'

const res = fetcher('https://example.com/api/posts') // GET
const data = await res.json()

const res = fetcher('https://example.com/api/posts', { method: 'POST', body: JSON.stringify(data) }) // POST
const data = await res.json()

```

### Private route page

```jsx
import { ProtectedRoute, withAuthentication } from '@think-grid-labs/react-starter-auth'

```


