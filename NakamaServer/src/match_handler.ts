let matchInit: nkruntime.MatchInitFunction = function (context: nkruntime.Context, logger: nkruntime.Logger, nakama: nkruntime.Nakama, params: { [key: string]: string })
{
    var label: MatchLabel = { open: true }
    var gameState: GameState =
    {
        players: [],
        realPlayers: [],
        loaded: [],
        playersWins: [],
        roundDeclaredWins: [[]],
        roundDeclaredDraw: [],
        scene: Scene.Lobby,
        countdown: DurationLobby * TickRate,
        endMatch: false,
        isSolo: false
    }

    return {
        state: gameState,
        tickRate: TickRate,
        label: JSON.stringify(label),
    }
}

let matchJoinAttempt: nkruntime.MatchJoinAttemptFunction = function (context: nkruntime.Context, logger: nkruntime.Logger, nakama: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, presence: nkruntime.Presence, metadata: { [key: string]: any })
{
    let gameState = state as GameState;
    return {
        state: gameState,
        accept: gameState.scene == Scene.Lobby,
    }
}

let matchJoin: nkruntime.MatchJoinFunction = function (context: nkruntime.Context, logger: nkruntime.Logger, nakama: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, presences: nkruntime.Presence[])
{
    let gameState = state as GameState;
    if (gameState.scene != Scene.Lobby)
        return { state: gameState };

    let presencesOnMatch: nkruntime.Presence[] = [];
    gameState.realPlayers.forEach(player => { if (player != undefined) presencesOnMatch.push(player.presence); });
    for (let presence of presences)
    {
        var account: nkruntime.Account = nakama.accountGetId(presence.userId);
        let profile: PlayerProfileData =
        {
            name: account.user.displayName,
            nickname: account.user.username,
            country: account.user.location,
            state: account.user.timezone,
            age: 0,
            profession: "",
            hobbies: [],
            avatar: account.user.avatarUrl
        }
        let player: Player =
        {
            presence: presence,
            playerProfileData: profile,
            isHost: false,
            playerNumber: -1
        }
        let nextPlayerNumber: number = getNextPlayerNumber(gameState.players);
        gameState.players[nextPlayerNumber] = player;
        gameState.loaded[nextPlayerNumber] = false;
        gameState.playersWins[nextPlayerNumber] = 0;
        if(player.presence.sessionId)
        {
            logger.info("Real Player joined %v", player.playerProfileData.name);
            gameState.realPlayers[nextPlayerNumber] = player;
        }
        let hostNumber = getHostNumber(gameState.players);
        //Host assignment
        if(hostNumber != -1)
            if(player.presence.sessionId)
                player.isHost = gameState.players[hostNumber].presence.sessionId == player.presence.sessionId;
            else
                player.isHost = false;  
        else
            player.isHost = true;
        player.playerNumber = nextPlayerNumber;
        //Make sure to refresh the player data 
        gameState.players[nextPlayerNumber] = player;
        dispatcher.broadcastMessage(OperationCode.PlayerJoined, JSON.stringify(player), presencesOnMatch);
        presencesOnMatch.push(presence);
    }

    dispatcher.broadcastMessage(OperationCode.Players, JSON.stringify(gameState.players), presences);
    //gameState.countdown = DurationLobby * TickRate;
    return { state: gameState };
}

let matchLoop: nkruntime.MatchLoopFunction = function (context: nkruntime.Context, logger: nkruntime.Logger, nakama: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, messages: nkruntime.MatchMessage[])
{
    let gameState = state as GameState;
    processMessages(messages, gameState, dispatcher, nakama, logger);
    processMatchLoop(gameState, nakama, dispatcher, logger);
    return gameState.endMatch ? null : { state: gameState };
}

let matchLeave: nkruntime.MatchLeaveFunction = function (context: nkruntime.Context, logger: nkruntime.Logger, nakama: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, presences: nkruntime.Presence[])
{
    let gameState = state as GameState;
    let hostLeft: boolean = false;
    for (let presence of presences)
    {
        let realPlayerNumber: number = getPlayerNumber(gameState.realPlayers, presence.sessionId);
        let playerNumber: number = getPlayerNumber(gameState.players, presence.sessionId);
        let leftRealPlayer: Player = gameState.realPlayers[realPlayerNumber];
        if(leftRealPlayer.isHost)
            hostLeft = true;
        delete gameState.realPlayers[realPlayerNumber];
        delete gameState.players[playerNumber]
    }
    if (getPlayersCount(gameState.realPlayers) == 0)
        return null;
    else if(hostLeft)
    {
        let nextPlayerNumber: number = getFirstPlayerNumber(gameState.realPlayers);
        if(nextPlayerNumber > 0)
        {
            let nextHost: Player = gameState.realPlayers[nextPlayerNumber]
            nextHost.isHost = true;
            //presences is null so all matches can receive hostchanged code
            dispatcher.broadcastMessage(OperationCode.HostChanged, JSON.stringify(nextHost), null);
        }
    }
    return { state: gameState };
}

let matchTerminate: nkruntime.MatchTerminateFunction = function (context: nkruntime.Context, logger: nkruntime.Logger, nakama: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, graceSeconds: number)
{
    return { state };
}

let matchSignal: nkruntime.MatchSignalFunction = function (context: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, data: string)
{
    return { state };
}

function processSoloMode(message: nkruntime.MatchMessage, gameState: GameState, dispatcher: nkruntime.MatchDispatcher, nakama: nkruntime.Nakama){
    gameState.isSolo = true;
}

function processMessages(messages: nkruntime.MatchMessage[], gameState: GameState, dispatcher: nkruntime.MatchDispatcher, nakama: nkruntime.Nakama, logger: nkruntime.Logger): void
{
    for (let message of messages)
    {
        let opCode: number = message.opCode;
        if (MessagesLogic.hasOwnProperty(opCode))
            MessagesLogic[opCode](message, gameState, dispatcher, nakama, logger);
        else
            messagesDefaultLogic(message, gameState, dispatcher);
    }
}

function messagesDefaultLogic(message: nkruntime.MatchMessage, gameState: GameState, dispatcher: nkruntime.MatchDispatcher): void
{
    dispatcher.broadcastMessage(message.opCode, message.data, null, message.sender);
}

function processMatchLoop(gameState: GameState, nakama: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, logger: nkruntime.Logger): void
{
    switch (gameState.scene)
    {
        case Scene.Game: matchLoopBattle(gameState, nakama, dispatcher); break;
        case Scene.Lobby: matchLoopLobby(gameState, nakama, dispatcher, logger); break;
    }
}

function matchLoopBattle(gameState: GameState, nakama: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher): void
{
    /*
    if (gameState.countdown > 0)
    {
        gameState.countdown--;
        if (gameState.countdown == 0)
        {
            gameState.roundDeclaredWins = [];
            gameState.roundDeclaredDraw = [];
            gameState.countdown = DurationRoundResults * TickRate;
            gameState.scene = Scene.Lobby;
            dispatcher.broadcastMessage(OperationCode.ChangeScene, JSON.stringify(gameState.scene));
        }
    }*/
}


function matchLoopLobby(gameState: GameState, nakama: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, logger: nkruntime.Logger): void
{
    //Add bots here
    let maxPlayersLobby = gameState.isSolo ? SoloMaxPlayers : MaxPlayers;
    logger.info("Max players in lobby %v", maxPlayersLobby)
    if (gameState.countdown > 0 && getPlayersCount(gameState.players) > 0)
    {
        gameState.countdown--;
        if(gameState.countdown <= nextBotTimer)
        {
            if(gameState.players.length < maxPlayersLobby)
            {
                //prevent joining from this point
                dispatcher.matchLabelUpdate(JSON.stringify({ open: false }));
                dispatcher.broadcastMessage(OperationCode.AddBot, null);
            }
            nextBotTimer -= TickRate;
        }
        if(gameState.countdown <= 0 || getPlayersCount(gameState.players) == maxPlayersLobby)
        {
            logger.info("Max players reached, command change scene");
            gameState.scene = Scene.Game;
            dispatcher.broadcastMessage(OperationCode.ChangeScene, JSON.stringify(gameState.scene));
        }
    }
}

function matchLoopRoundResults(gameState: GameState, nakama: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher): void
{
    if (gameState.countdown > 0)
    {
        gameState.countdown--;
        if (gameState.countdown == 0)
        {
            var winner = getWinner(gameState.playersWins, gameState.players);
            if (winner != null)
            {
                let storageReadRequests: nkruntime.StorageReadRequest[] = [{
                    collection: CollectionUser,
                    key: KeyTrophies,
                    userId: winner.presence.userId
                }];

                let result: nkruntime.StorageObject[] = nakama.storageRead(storageReadRequests);
                var trophiesData: TrophiesData = { amount: 0 };
                for (let storageObject of result)
                {
                    trophiesData = <TrophiesData>storageObject.value;
                    break;
                }

                trophiesData.amount++;
                let storageWriteRequests: nkruntime.StorageWriteRequest[] = [{
                    collection: CollectionUser,
                    key: KeyTrophies,
                    userId: winner.presence.userId,
                    value: trophiesData
                }];

                nakama.storageWrite(storageWriteRequests);
                gameState.endMatch = true;
                gameState.scene = Scene.Lobby;
            }
            else
            {
                gameState.scene = Scene.Game;
            }

            dispatcher.broadcastMessage(OperationCode.ChangeScene, JSON.stringify(gameState.scene));
        }
    }
}

function matchStart(message: nkruntime.MatchMessage, gameState: GameState, dispatcher: nkruntime.MatchDispatcher, nakama: nkruntime.Nakama) : void
{
    gameState.scene = Scene.Game;
    dispatcher.broadcastMessage(OperationCode.ChangeScene, JSON.stringify(gameState.scene));
}

function botJoined(message: nkruntime.MatchMessage, gameState: GameState, dispatcher: nkruntime.MatchDispatcher, nakama: nkruntime.Nakama, logger: nkruntime.Logger) : void
{
    let botPlayer: Player = JSON.parse(nakama.binaryToString(message.data));
    let botPlayerNumber: number = getNextPlayerNumber(gameState.players);
    botPlayer.playerNumber = botPlayerNumber;
    gameState.players[botPlayerNumber] = botPlayer;
    logger.info("Bot Joined %v", JSON.stringify(botPlayer));
    dispatcher.broadcastMessage(OperationCode.PlayerJoined, JSON.stringify(botPlayer), null);
}

function gameLoaded(message: nkruntime.MatchMessage, gameState: GameState, dispatcher: nkruntime.MatchDispatcher, nakama: nkruntime.Nakama) : void
{
    let data: Player = JSON.parse(nakama.binaryToString(message.data));
    let playerNumber: number = data.playerNumber;
    gameState.loaded[playerNumber] = true;
    if(isPlayersReady(gameState.loaded))
    {
        dispatcher.broadcastMessage(OperationCode.GameReady, JSON.stringify(gameState));
    }
       
}

function playerWon(message: nkruntime.MatchMessage, gameState: GameState, dispatcher: nkruntime.MatchDispatcher, nakama: nkruntime.Nakama): void 
{
    if (gameState.scene != Scene.Game || gameState.countdown > 0)
        return;

    
    let data: PlayerWonData = JSON.parse(nakama.binaryToString(message.data));
    let tick: number = data.tick;
    let playerNumber: number = data.playerNumber;
    if (gameState.roundDeclaredWins[tick] == undefined)
        gameState.roundDeclaredWins[tick] = [];

    if (gameState.roundDeclaredWins[tick][playerNumber] == undefined)
        gameState.roundDeclaredWins[tick][playerNumber] = 0;

    gameState.roundDeclaredWins[tick][playerNumber]++;
    if (gameState.roundDeclaredWins[tick][playerNumber] < getPlayersCount(gameState.players))
        return;

    gameState.playersWins[playerNumber]++;
    gameState.countdown = DurationBattleEnding * TickRate;
    dispatcher.broadcastMessage(message.opCode, message.data, null, message.sender);
}

function draw(message: nkruntime.MatchMessage, gameState: GameState, dispatcher: nkruntime.MatchDispatcher, nakama: nkruntime.Nakama): void
{
    if (gameState.scene != Scene.Game || gameState.countdown > 0)
        return;

    let data: DrawData = JSON.parse(nakama.binaryToString(message.data));
    let tick: number = data.tick;
    if (gameState.roundDeclaredDraw[tick] == undefined)
        gameState.roundDeclaredDraw[tick] = 0;

    gameState.roundDeclaredDraw[tick]++;
    if (gameState.roundDeclaredDraw[tick] < getPlayersCount(gameState.players))
        return;

    gameState.countdown = DurationBattleEnding * TickRate;
    dispatcher.broadcastMessage(message.opCode, message.data, null, message.sender);
}

function getPlayersCount(players: Player[]): number
{
    var count: number = 0;
    for (let playerNumber = 0; playerNumber < MaxPlayers; playerNumber++)
        if (players[playerNumber] != undefined)
            count++;

    return count;
}

function playerObtainedNecessaryWins(playersWins: number[]): boolean
{
    for (let playerNumber = 0; playerNumber < MaxPlayers; playerNumber++)
        if (playersWins[playerNumber] == NecessaryWins)
            return true;

    return false;
}

function getWinner(playersWins: number[], players: Player[]): Player | null
{
    for (let playerNumber = 0; playerNumber < MaxPlayers; playerNumber++)
        if (playersWins[playerNumber] == NecessaryWins)
            return players[playerNumber];

    return null;
}

function getPlayerNumber(players: Player[], sessionId: string): number
{
    for (let playerNumber = 0; playerNumber < MaxPlayers; playerNumber++)
        if (players[playerNumber] != undefined && players[playerNumber].presence.sessionId == sessionId)
            return playerNumber;

    return PlayerNotFound;
}

function getHostNumber(players: Player[]): number{
    for (let playerNumber = 0; playerNumber < MaxPlayers; playerNumber++)
        if (players[playerNumber] != undefined && players[playerNumber].isHost)
            return playerNumber;
    return PlayerNotFound
}

function isFirstPlayer(players: Player[]): boolean
{
    if (players.length === 1) 
        return true;
    else 
        return false;
}

function isPlayersReady(players: boolean[]): boolean
{
    for (let playerNumber = 0; playerNumber < MaxPlayers; playerNumber++)
        if(players[playerNumber] == false)
            return false;
    return true;
}

function getNextPlayerNumber(players: Player[]): number
{
    for (let playerNumber = 0; playerNumber < MaxPlayers; playerNumber++)
        if (!playerNumberIsUsed(players, playerNumber))
            return playerNumber;

    return PlayerNotFound;
}

function getFirstPlayerNumber(players: Player[]): number
{
    for (let playerNumber = 0; playerNumber < MaxPlayers; playerNumber++)
        if (playerNumberIsUsed(players, playerNumber))
            return playerNumber;

    return PlayerNotFound;
}

function playerNumberIsUsed(players: Player[], playerNumber: number): boolean
{
    return players[playerNumber] != undefined;
}
