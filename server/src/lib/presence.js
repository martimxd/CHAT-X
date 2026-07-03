const onlineUsers = new Map();

export function incrementOnline(userId) {
  const count = onlineUsers.get(userId) || 0;
  onlineUsers.set(userId, count + 1);
  return count === 0;
}

export function decrementOnline(userId) {
  const count = onlineUsers.get(userId) || 0;
  if (count <= 1) {
    onlineUsers.delete(userId);
    return true;
  }
  onlineUsers.set(userId, count - 1);
  return false;
}

export function isUserOnline(userId) {
  return onlineUsers.has(userId);
}

export function onlineCount(userIds) {
  return userIds.filter((userId) => onlineUsers.has(userId)).length;
}
