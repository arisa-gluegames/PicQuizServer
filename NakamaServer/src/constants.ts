
const TickRate = 16;
const DurationLobby = 4;
const DurationAddBots = 3;
const DurationRoundResults = 5;
const DurationBattleEnding = 3;
const NecessaryWins = 3;
const MaxPlayers = 3;
const SoloMaxPlayers = 1;
const PlayerNotFound = -1;
const CollectionUser = "User";
const KeyTrophies = "Trophies";
let nextBotTimer : number = DurationAddBots * TickRate;

const MessagesLogic: { [opCode: number]: (message: nkruntime.MatchMessage, state: GameState, dispatcher: nkruntime.MatchDispatcher, nakama: nkruntime.Nakama, logger: nkruntime.Logger) => void } =
{
    3: matchStart,
    4: botJoined,
    6: gameLoaded,
    11: processSoloMode,
    12: processGameLevel
}
