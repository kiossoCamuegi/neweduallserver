import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Welcome from './app/Screens/LoadersAndExtras/Welcome';
import SplashScreen from './app/Screens/LoadersAndExtras/SplashScreen';
import AuthenticationScreens from './app/Screens/Authentication';
import HomeTabScreens from './app/Screens/Feednews';
import UserProfile from './app/Screens/Profile/screens/UserProfile';
import WatchShortVideos from './app/Screens/Feednews/screens/WatchShortVideos';
import UserProfileHeader from './app/Screens/Profile/components/UserProfileHeader';


const EduallStack = createNativeStackNavigator();

export default function App() {

  const navigationOptions = {
    headerShown: false,
    tabBarShowLabel: false,  
    headerBackVisible:false
  }

  

const options1 = {
  tabBarShowLabel: false, 
  headerTintColor: "white",  
  headerShown:true,  
  headerTitle: (props) => <UserProfileHeader />,
  headerTitleAlign:"left",
  headerStyle: {
    backgroundColor: '#ffff',
    height:100,
    flex:1,
  }, 
}
   

  return (
    <NavigationContainer>
      <EduallStack.Navigator initialRouteName={"splashscreen"} screenOptions={navigationOptions}>
        <EduallStack.Screen name="splashscreen" component={SplashScreen} />
        <EduallStack.Screen name="welcome" component={Welcome} /> 
        <EduallStack.Screen name="AuthScreens" options={{ headerShown: false }} component={AuthenticationScreens} /> 
        <EduallStack.Screen name="HomeTabsScreen" options={{ headerShown: false }} component={HomeTabScreens} /> 
        <EduallStack.Screen name="shortvideos" options={{ headerShown: false }} component={WatchShortVideos} /> 
        <EduallStack.Screen name="userprofile" options={options1} component={UserProfile} /> 
      </EduallStack.Navigator> 
    </NavigationContainer>
  );
}

