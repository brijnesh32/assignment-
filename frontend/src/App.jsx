import ActivityFeed from './components/ActivityFeed'

export default function App() {
  return (
    <ActivityFeed
      tenantId="65a1f2c3b4d5e6f7a8b9c0d1"
      currentUser={{ _id: "65a1f2c3b4d5e6f7a8b9c0d2", name: "Test User" }}
    />
  )
}